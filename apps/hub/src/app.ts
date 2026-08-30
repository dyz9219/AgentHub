import {
  AcknowledgeMessageRequestSchema,
  HeartbeatRequestSchema,
  InboxQuerySchema,
  RegisterAgentRequestSchema,
  RegisterRunnerRequestSchema,
  SendMessageRequestSchema
} from "@agenthub/shared";
import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod/v4";
import type { HubConfig } from "./config.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import { HubDatabase } from "./database.js";
import { createHubMcpHandler } from "./mcp.js";
import { HubService } from "./service.js";

function tokenFrom(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  const header = request.headers["x-agenthub-token"];
  return Array.isArray(header) ? header[0] : header;
}

export interface HubApp {
  app: FastifyInstance;
  database: HubDatabase;
  service: HubService;
}

export function buildHubApp(config: HubConfig): HubApp {
  const app = createMcpFastifyApp({
    host: config.host,
    allowedHosts: config.allowedHosts
  });
  const database = new HubDatabase(config.databasePath);
  const service = new HubService(database, config.offlineAfterMs);
  const mcpHandler = toNodeHandler(createHubMcpHandler(service));

  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (tokenFrom(request) !== config.token) {
      await reply.code(401).send({ error: "unauthorized", message: "Supply a valid AgentHub bearer token" });
    }
  }

  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof z.ZodError) {
      await reply.code(400).send({
        error: "invalid_request",
        message: z.prettifyError(error)
      });
      return;
    }
    await reply.code(400).send({
      error: "agenthub_error",
      message: error instanceof Error ? error.message : String(error)
    });
  });

  app.get("/healthz", async () => service.getStatus());
  app.get("/", async (_request, reply) => {
    await reply
      .header("content-type", "text/html; charset=utf-8")
      .header("x-content-type-options", "nosniff")
      .send(DASHBOARD_HTML);
  });

  app.get("/api/v1/dashboard", { preHandler: requireAuth }, async () => ({
    status: service.getStatus(),
    runners: service.listRunners(),
    agents: service.listAgents()
  }));

  app.post("/api/v1/runners/register", { preHandler: requireAuth }, async request => {
    return service.registerRunner(RegisterRunnerRequestSchema.parse(request.body));
  });

  app.post("/api/v1/runners/:runnerId/heartbeat", { preHandler: requireAuth }, async request => {
    const params = z.object({ runnerId: z.uuid() }).parse(request.params);
    return service.heartbeat(params.runnerId, HeartbeatRequestSchema.parse(request.body));
  });

  app.post("/api/v1/agents/register", { preHandler: requireAuth }, async request => {
    return service.registerAgent(RegisterAgentRequestSchema.parse(request.body));
  });

  app.get("/api/v1/agents", { preHandler: requireAuth }, async request => {
    const query = z.object({ projectKey: z.string().min(1).max(120).optional() }).parse(request.query);
    return { agents: service.listAgents(query.projectKey) };
  });

  app.post("/api/v1/messages", { preHandler: requireAuth }, async request => {
    return service.sendMessage(SendMessageRequestSchema.parse(request.body));
  });

  app.get("/api/v1/inbox", { preHandler: requireAuth }, async request => {
    return { messages: service.readInbox(InboxQuerySchema.parse(request.query)) };
  });

  app.post("/api/v1/messages/:messageId/ack", { preHandler: requireAuth }, async request => {
    const params = z.object({ messageId: z.uuid() }).parse(request.params);
    service.acknowledgeMessage(
      params.messageId,
      AcknowledgeMessageRequestSchema.parse(request.body)
    );
    return { ok: true };
  });

  app.all("/mcp", { preHandler: requireAuth }, async (request, reply) => {
    return mcpHandler(
      request.raw as Parameters<typeof mcpHandler>[0],
      reply.raw,
      request.body
    );
  });

  app.addHook("onClose", async () => {
    database.close();
  });

  return { app, database, service };
}
