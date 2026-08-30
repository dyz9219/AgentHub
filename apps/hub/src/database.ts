import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class HubDatabase {
  readonly connection: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.connection = new DatabaseSync(databasePath);
    this.connection.exec("PRAGMA foreign_keys = ON");
    if (databasePath !== ":memory:") {
      this.connection.exec("PRAGMA journal_mode = WAL");
    }
    this.migrate();
  }

  close(): void {
    this.connection.close();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS runners (
        runner_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        machine_name TEXT NOT NULL,
        os TEXT NOT NULL,
        version TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        runner_id TEXT NOT NULL REFERENCES runners(runner_id),
        project_key TEXT NOT NULL,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        repo_fingerprint TEXT NOT NULL,
        session_binding_ref TEXT NOT NULL UNIQUE,
        session_binding_status TEXT NOT NULL,
        permission_mode TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agents_project_key ON agents(project_key);
      CREATE INDEX IF NOT EXISTS idx_agents_runner_id ON agents(runner_id);

      CREATE TABLE IF NOT EXISTS messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        sender_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        attachment_ids_json TEXT NOT NULL,
        reply_to_message_id TEXT NULL REFERENCES messages(message_id),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sequence);

      CREATE TABLE IF NOT EXISTS message_recipients (
        message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
        recipient_agent_id TEXT NOT NULL REFERENCES agents(agent_id),
        delivery_status TEXT NOT NULL DEFAULT 'queued',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (message_id, recipient_agent_id)
      );

      CREATE INDEX IF NOT EXISTS idx_recipients_inbox
        ON message_recipients(recipient_agent_id, delivery_status);
    `);
  }
}
