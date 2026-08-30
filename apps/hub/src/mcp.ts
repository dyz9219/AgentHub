import {
  InboxQuerySchema,
  RegisterAgentRequestSchema,
  SendMessageRequestSchema
} from "@agenthub/shared";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { HubService } from "./service.js";

function result(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const structuredContent = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : { value };
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent
  };
}

function failure(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{
      type: "text",
      text: error instanceof Error ? error.message : "Unexpected AgentHub error"
    }],
    isError: true
  };
}

export function createHubMcpServer(service: HubService): McpServer {
  const server = new McpServer({ name: "agenthub-mcp-server", version: "0.1.0" });

  server.registerTool(
    "agenthub_get_status",
    {
      title: "Get AgentHub status",
      description: "Read Hub health and online Runner/Agent counts. This does not inspect local repositories or provider sessions.",
      outputSchema: z.object({
        ok: z.literal(true),
        serverTime: z.string(),
        runners: z.object({ online: z.number(), total: z.number() }),
        agents: z.object({ online: z.number(), total: z.number() })
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async () => result(service.getStatus())
  );

  server.registerTool(
    "agenthub_list_agents",
    {
      title: "List registered agents",
      description: "List registered AgentHub roles, optionally limited to one shared project key. Session IDs and local paths are never returned.",
      inputSchema: z.object({
        projectKey: z.string().trim().min(1).max(120).optional()
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ projectKey }) => result({ agents: service.listAgents(projectKey) })
  );

  server.registerTool(
    "agenthub_register_agent",
    {
      title: "Register a Runner-bound agent",
      description: "Register an Agent after its local Runner has securely bound a provider session and repository. Call the local Runner registration tools from normal Codex/Claude sessions; do not invent binding references.",
      inputSchema: RegisterAgentRequestSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async input => {
      try {
        return result(service.registerAgent(input));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "agenthub_send_message",
    {
      title: "Send an AgentHub message",
      description: "Queue a durable text message for one or more registered agents. The idempotency key must be reused when retrying the same logical send.",
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
        return result(service.sendMessage(input));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "agenthub_read_inbox",
    {
      title: "Read an agent inbox",
      description: "Read queued messages for one registered Agent, ordered by durable sequence. Use after and limit for bounded pagination.",
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
        return result({ messages: service.readInbox(input) });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerPrompt(
    "agenthub-register-current-agent",
    {
      title: "Register current Agent",
      description: "Guide an Agent to register its current repository and exact provider session through the local AgentHub Runner.",
      argsSchema: z.object({
        projectKey: z.string().min(1),
        role: z.string().min(1),
        permissionMode: z.enum(["confirm_write", "full_auto"]).default("confirm_write")
      })
    },
    ({ projectKey, role, permissionMode }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Register this exact current project session with AgentHub. Verify the Git root, then call the local Runner tools agenthub_begin_registration and agenthub_complete_registration. Use projectKey=${projectKey}, role=${role}, permissionMode=${permissionMode}. Never guess or expose a provider session ID, credential, or absolute path to Hub.`
        }
      }]
    })
  );

  return server;
}

export function createHubMcpHandler(service: HubService): ReturnType<typeof createMcpHandler> {
  return createMcpHandler(() => createHubMcpServer(service));
}
