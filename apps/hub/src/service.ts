import { randomUUID } from "node:crypto";
import type {
  AgentRecord,
  AcknowledgeMessageRequest,
  HeartbeatRequest,
  HubStatus,
  InboxQuery,
  MessageRecord,
  RegisterAgentRequest,
  RegisterRunnerRequest,
  RunnerRecord,
  SendMessageRequest
} from "@agenthub/shared";
import { HubDatabase } from "./database.js";

interface RunnerRow {
  runner_id: string;
  name: string;
  machine_name: string;
  os: string;
  version: string;
  capabilities_json: string;
  status: "online" | "busy" | "degraded";
  created_at: string;
  last_seen_at: string;
}

interface AgentRow {
  agent_id: string;
  runner_id: string;
  project_key: string;
  role: string;
  display_name: string;
  provider: "codex" | "claude";
  repo_fingerprint: string;
  session_binding_ref: string;
  session_binding_status: "pending" | "bound" | "stale";
  permission_mode: "confirm_write" | "full_auto";
  capabilities_json: string;
  status: "online" | "offline" | "busy" | "blocked" | "waiting_approval";
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  sequence: number;
  message_id: string;
  conversation_id: string;
  trace_id: string;
  sender_agent_id: string;
  kind: MessageRecord["kind"];
  text: string;
  attachment_ids_json: string;
  reply_to_message_id: string | null;
  created_at: string;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === "string")) {
    throw new Error("Stored JSON array is invalid");
  }
  return parsed;
}

export class HubService {
  constructor(
    private readonly database: HubDatabase,
    private readonly offlineAfterMs: number
  ) {}

  registerRunner(input: RegisterRunnerRequest): RunnerRecord {
    const now = new Date().toISOString();
    this.database.connection.prepare(`
      INSERT INTO runners (
        runner_id, name, machine_name, os, version, capabilities_json, status, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'online', ?, ?)
      ON CONFLICT(runner_id) DO UPDATE SET
        name = excluded.name,
        machine_name = excluded.machine_name,
        os = excluded.os,
        version = excluded.version,
        capabilities_json = excluded.capabilities_json,
        status = 'online',
        last_seen_at = excluded.last_seen_at
    `).run(
      input.runnerId,
      input.name,
      input.machineName,
      input.os,
      input.version,
      JSON.stringify(input.capabilities),
      now,
      now
    );
    return this.getRunner(input.runnerId);
  }

  heartbeat(runnerId: string, input: HeartbeatRequest): RunnerRecord {
    const result = this.database.connection.prepare(`
      UPDATE runners SET status = ?, last_seen_at = ? WHERE runner_id = ?
    `).run(input.status, new Date().toISOString(), runnerId);
    if (result.changes === 0) {
      throw new Error(`Runner ${runnerId} is not registered; call runner registration first`);
    }

    if (input.agentIds.length > 0) {
      const placeholders = input.agentIds.map(() => "?").join(",");
      this.database.connection.prepare(`
        UPDATE agents SET status = 'online', updated_at = ?
        WHERE runner_id = ? AND agent_id IN (${placeholders})
      `).run(new Date().toISOString(), runnerId, ...input.agentIds);
    }
    return this.getRunner(runnerId);
  }

  registerAgent(input: RegisterAgentRequest): AgentRecord {
    const existing = this.database.connection.prepare(
      "SELECT * FROM agents WHERE idempotency_key = ?"
    ).get(input.idempotencyKey) as AgentRow | undefined;
    if (existing) {
      return this.mapAgent(existing);
    }

    this.getRunner(input.runnerId);
    const agentId = input.agentId ?? randomUUID();
    const now = new Date().toISOString();
    this.database.connection.prepare(`
      INSERT INTO agents (
        agent_id, idempotency_key, runner_id, project_key, role, display_name, provider,
        repo_fingerprint, session_binding_ref, session_binding_status, permission_mode,
        capabilities_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?)
    `).run(
      agentId,
      input.idempotencyKey,
      input.runnerId,
      input.projectKey,
      input.role,
      input.displayName,
      input.provider,
      input.repoFingerprint,
      input.sessionBindingRef,
      input.sessionBindingStatus,
      input.permissionMode,
      JSON.stringify(input.capabilities),
      now,
      now
    );
    return this.getAgent(agentId);
  }

  listRunners(): RunnerRecord[] {
    const rows = this.database.connection.prepare(
      "SELECT * FROM runners ORDER BY name, runner_id"
    ).all() as unknown as RunnerRow[];
    return rows.map(row => this.mapRunner(row));
  }

  listAgents(projectKey?: string): AgentRecord[] {
    const rows = projectKey
      ? this.database.connection.prepare(
          "SELECT * FROM agents WHERE project_key = ? ORDER BY role, display_name"
        ).all(projectKey) as unknown as AgentRow[]
      : this.database.connection.prepare(
          "SELECT * FROM agents ORDER BY project_key, role, display_name"
        ).all() as unknown as AgentRow[];
    return rows.map(row => this.mapAgent(row));
  }

  sendMessage(input: SendMessageRequest): MessageRecord {
    const existing = this.database.connection.prepare(
      "SELECT * FROM messages WHERE idempotency_key = ?"
    ).get(input.idempotencyKey) as MessageRow | undefined;
    if (existing) {
      return this.mapMessage(existing);
    }

    this.getAgent(input.senderAgentId);
    for (const recipientId of input.recipientAgentIds) {
      this.getAgent(recipientId);
    }

    const messageId = input.messageId ?? randomUUID();
    const conversationId = input.conversationId ?? randomUUID();
    const traceId = randomUUID();
    const now = new Date().toISOString();
    const transaction = this.database.connection.prepare("BEGIN IMMEDIATE");
    transaction.run();
    try {
      this.database.connection.prepare(`
        INSERT INTO messages (
          message_id, idempotency_key, conversation_id, trace_id, sender_agent_id,
          kind, text, attachment_ids_json, reply_to_message_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        input.idempotencyKey,
        conversationId,
        traceId,
        input.senderAgentId,
        input.kind,
        input.text,
        JSON.stringify(input.attachmentIds),
        input.replyToMessageId ?? null,
        now
      );
      const recipientStatement = this.database.connection.prepare(`
        INSERT INTO message_recipients (
          message_id, recipient_agent_id, delivery_status, updated_at
        ) VALUES (?, ?, 'queued', ?)
      `);
      for (const recipientId of new Set(input.recipientAgentIds)) {
        recipientStatement.run(messageId, recipientId, now);
      }
      this.database.connection.exec("COMMIT");
    } catch (error) {
      this.database.connection.exec("ROLLBACK");
      throw error;
    }
    return this.getMessage(messageId);
  }

  readInbox(query: InboxQuery): MessageRecord[] {
    this.getAgent(query.agentId);
    const rows = this.database.connection.prepare(`
      SELECT m.* FROM messages m
      INNER JOIN message_recipients r ON r.message_id = m.message_id
      WHERE r.recipient_agent_id = ? AND m.sequence > ?
      ORDER BY m.sequence ASC
      LIMIT ?
    `).all(query.agentId, query.after, query.limit) as unknown as MessageRow[];
    return rows.map(row => this.mapMessage(row));
  }

  acknowledgeMessage(messageId: string, input: AcknowledgeMessageRequest): void {
    const result = this.database.connection.prepare(`
      UPDATE message_recipients SET delivery_status = ?, updated_at = ?
      WHERE message_id = ? AND recipient_agent_id = ?
    `).run(input.status, new Date().toISOString(), messageId, input.agentId);
    if (result.changes === 0) {
      throw new Error("Message recipient record was not found");
    }
  }

  getStatus(): HubStatus {
    const runners = this.listRunners();
    const agents = this.listAgents();
    return {
      ok: true,
      serverTime: new Date().toISOString(),
      runners: {
        online: runners.filter(runner => runner.status !== "offline").length,
        total: runners.length
      },
      agents: {
        online: agents.filter(agent => agent.status === "online").length,
        total: agents.length
      }
    };
  }

  private getRunner(runnerId: string): RunnerRecord {
    const row = this.database.connection.prepare(
      "SELECT * FROM runners WHERE runner_id = ?"
    ).get(runnerId) as RunnerRow | undefined;
    if (!row) {
      throw new Error(`Runner ${runnerId} was not found`);
    }
    return this.mapRunner(row);
  }

  private getAgent(agentId: string): AgentRecord {
    const row = this.database.connection.prepare(
      "SELECT * FROM agents WHERE agent_id = ?"
    ).get(agentId) as AgentRow | undefined;
    if (!row) {
      throw new Error(`Agent ${agentId} was not found`);
    }
    return this.mapAgent(row);
  }

  private getMessage(messageId: string): MessageRecord {
    const row = this.database.connection.prepare(
      "SELECT * FROM messages WHERE message_id = ?"
    ).get(messageId) as MessageRow | undefined;
    if (!row) {
      throw new Error(`Message ${messageId} was not found`);
    }
    return this.mapMessage(row);
  }

  private mapRunner(row: RunnerRow): RunnerRecord {
    const isOffline = Date.now() - Date.parse(row.last_seen_at) > this.offlineAfterMs;
    return {
      runnerId: row.runner_id,
      name: row.name,
      machineName: row.machine_name,
      os: row.os,
      version: row.version,
      capabilities: parseStringArray(row.capabilities_json),
      status: isOffline ? "offline" : row.status,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at
    };
  }

  private mapAgent(row: AgentRow): AgentRecord {
    const runner = this.getRunnerForMapping(row.runner_id);
    const status = runner.status === "offline" ? "offline" : row.status;
    return {
      agentId: row.agent_id,
      runnerId: row.runner_id,
      projectKey: row.project_key,
      role: row.role,
      displayName: row.display_name,
      provider: row.provider,
      repoFingerprint: row.repo_fingerprint,
      sessionBindingRef: row.session_binding_ref,
      sessionBindingStatus: row.session_binding_status,
      permissionMode: row.permission_mode,
      capabilities: parseStringArray(row.capabilities_json),
      status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private getRunnerForMapping(runnerId: string): RunnerRecord {
    const row = this.database.connection.prepare(
      "SELECT * FROM runners WHERE runner_id = ?"
    ).get(runnerId) as RunnerRow | undefined;
    if (!row) {
      throw new Error(`Runner ${runnerId} was not found for agent mapping`);
    }
    return this.mapRunner(row);
  }

  private mapMessage(row: MessageRow): MessageRecord {
    const recipients = this.database.connection.prepare(`
      SELECT recipient_agent_id FROM message_recipients
      WHERE message_id = ? ORDER BY recipient_agent_id
    `).all(row.message_id) as unknown as Array<{ recipient_agent_id: string }>;
    return {
      sequence: row.sequence,
      messageId: row.message_id,
      conversationId: row.conversation_id,
      traceId: row.trace_id,
      senderAgentId: row.sender_agent_id,
      recipientAgentIds: recipients.map(item => item.recipient_agent_id),
      kind: row.kind,
      text: row.text,
      attachmentIds: parseStringArray(row.attachment_ids_json),
      replyToMessageId: row.reply_to_message_id,
      createdAt: row.created_at
    };
  }
}
