import { randomUUID } from "node:crypto";
import {
  BeginRegistrationInputSchema,
  CompleteRegistrationInputSchema,
  InboxQuerySchema,
  SendMessageRequestSchema
} from "@agenthub/shared";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import type { RunnerConfig } from "./config.js";
import { HubClient } from "./hub-client.js";
import { RegistrationService } from "./registration.js";
import { LocalState } from "./state.js";

function result(value: unknown) {
  const structuredContent = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : { value };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent
  };
}

function failure(error: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: error instanceof Error ? error.message : "Unexpected AgentHub Runner error"
    }],
    isError: true as const
  };
}

export function createRunnerMcpServer(
  config: RunnerConfig,
  state: LocalState,
  hub: HubClient,
  registration: RegistrationService
): McpServer {
  const server = new McpServer({ name: "agenthub-runner-mcp-server", version: "0.1.0" });

  server.registerTool(
    "agenthub_get_connection_status",
    {
      title: "Get local AgentHub connection status",
      description: "Check Hub reachability, local Runner daemon freshness, and registered local roles. Does not mutate Hub or expose provider session IDs and workspace paths.",
      outputSchema: z.object({
        runnerId: z.string(),
        runnerName: z.string(),
        hubUrl: z.string(),
        hubConnected: z.boolean(),
        daemonRunning: z.boolean(),
        bindings: z.array(z.object({
          agentId: z.string(),
          projectKey: z.string(),
          role: z.string(),
          provider: z.string(),
          permissionMode: z.string(),
          sessionBound: z.literal(true)
        })),
        error: z.string().nullable()
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async () => {
      let hubConnected = false;
      let error: string | null = null;
      try {
        await hub.getStatus();
        hubConnected = true;
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const daemon = state.readDaemonStatus();
      const daemonRunning = Boolean(
        daemon?.lastHeartbeatAt
        && Date.now() - Date.parse(daemon.lastHeartbeatAt) < config.heartbeatIntervalMs * 3
      );
      return result({
        runnerId: config.runnerId,
        runnerName: config.runnerName,
        hubUrl: config.hubUrl,
        hubConnected,
        daemonRunning,
        bindings: state.listBindings().map(binding => ({
          agentId: binding.agentId,
          projectKey: binding.projectKey,
          role: binding.role,
          provider: binding.provider,
          permissionMode: binding.permissionMode,
          sessionBound: true as const
        })),
        error
      });
    }
  );

  server.registerTool(
    "agenthub_begin_registration",
    {
      title: "Begin current Agent registration",
      description: `Begin binding the exact current Codex or Claude task to its local repository and AgentHub role.

Call this when the user asks to register the current Agent or project with AgentHub. Use the verified absolute project path and the role the user requested. This creates no code changes. It returns a one-time challenge; immediately call agenthub_complete_registration with that exact value from the same task. Never ask the user to copy the challenge, never guess a provider session ID, and never send credentials.`,
      inputSchema: BeginRegistrationInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async input => {
      try {
        return result(registration.begin(input));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "agenthub_complete_registration",
    {
      title: "Complete current Agent registration",
      description: "Complete a registration begun in this exact task. Pass the challenge unchanged. Runner locates the challenge in the local provider transcript, verifies the workspace, stores the real session ID only locally, and sends an opaque binding reference to Hub.",
      inputSchema: CompleteRegistrationInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ challenge }) => {
      try {
        return result(await registration.complete(challenge));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "agenthub_list_agents",
    {
      title: "List AgentHub peers",
      description: "List registered roles available for collaboration, optionally within one project. Does not return local paths or provider session IDs.",
      inputSchema: z.object({ projectKey: z.string().trim().min(1).max(120).optional() }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ projectKey }) => {
      try {
        return result({ agents: await hub.listAgents(projectKey) });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "agenthub_send_message",
    {
      title: "Send a collaboration message",
      description: "Send a durable proposal, objection, question, approval, blocker, result, or text message to registered peers. This is communication only and never grants code-write permission.",
      inputSchema: SendMessageRequestSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async input => {
      try {
        return result(await hub.sendMessage(input));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "agenthub_read_inbox",
    {
      title: "Read collaboration inbox",
      description: "Read durable messages addressed to a registered local Agent in sequence order. Use after for incremental reads and acknowledge handled messages separately.",
      inputSchema: InboxQuerySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async input => {
      try {
        return result({ messages: await hub.readInbox(input.agentId, input.after, input.limit) });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "agenthub_acknowledge_message",
    {
      title: "Acknowledge a collaboration message",
      description: "Mark one inbox message as delivered, read, or handled for the addressed Agent. This is idempotent and does not modify code.",
      inputSchema: z.object({
        messageId: z.uuid(),
        agentId: z.uuid(),
        status: z.enum(["delivered", "read", "handled"])
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ messageId, agentId, status }) => {
      try {
        await hub.acknowledgeMessage(messageId, agentId, status);
        return result({ ok: true });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerPrompt(
    "agenthub-register-current-agent",
    {
      title: "Register this Agent with AgentHub",
      description: "Register the exact current provider task and repository using the local Runner.",
      argsSchema: z.object({
        projectKey: z.string().min(1),
        role: z.string().min(1),
        provider: z.enum(["codex", "claude"]),
        permissionMode: z.enum(["confirm_write", "full_auto"]).default("confirm_write")
      })
    },
    ({ projectKey, role, provider, permissionMode }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Verify the current repository root, then register this exact task with AgentHub as project ${projectKey}, role ${role}, provider ${provider}, permission ${permissionMode}. Call agenthub_begin_registration followed immediately by agenthub_complete_registration. Do not modify code, guess a session ID, or ask me to copy the challenge.`
        }
      }]
    })
  );

  return server;
}

export async function runMcpServer(
  config: RunnerConfig,
  state: LocalState,
  hub: HubClient,
  registration: RegistrationService
): Promise<void> {
  await serveStdio(() => createRunnerMcpServer(config, state, hub, registration));
  console.error(`AgentHub Runner MCP ready (${config.runnerId})`);
}

export function newMessageIdempotencyKey(): string {
  return `message:${randomUUID()}`;
}
