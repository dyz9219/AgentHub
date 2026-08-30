import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BeginRegistrationInput, MessageRecord, PermissionMode, Provider } from "@agenthub/shared";
import * as z from "zod/v4";
import { atomicWriteJson, stateDirectory } from "./config.js";

const PendingRegistrationSchema = z.object({
  challenge: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  workspaceRoot: z.string(),
  repoFingerprint: z.string(),
  draft: z.object({
    projectKey: z.string(),
    role: z.string(),
    displayName: z.string(),
    provider: z.enum(["codex", "claude"]),
    workspacePath: z.string(),
    permissionMode: z.enum(["confirm_write", "full_auto"]),
    capabilities: z.array(z.string())
  })
});

export interface PendingRegistration {
  challenge: string;
  createdAt: string;
  expiresAt: string;
  workspaceRoot: string;
  repoFingerprint: string;
  draft: BeginRegistrationInput;
}

const LocalBindingSchema = z.object({
  agentId: z.uuid(),
  runnerId: z.uuid(),
  projectKey: z.string(),
  role: z.string(),
  displayName: z.string(),
  provider: z.enum(["codex", "claude"]),
  providerSessionId: z.string(),
  workspacePath: z.string(),
  repoFingerprint: z.string(),
  sessionBindingRef: z.string(),
  permissionMode: z.enum(["confirm_write", "full_auto"]),
  capabilities: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string()
});

export interface LocalBinding {
  agentId: string;
  runnerId: string;
  projectKey: string;
  role: string;
  displayName: string;
  provider: Provider;
  providerSessionId: string;
  workspacePath: string;
  repoFingerprint: string;
  sessionBindingRef: string;
  permissionMode: PermissionMode;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
}

const DaemonStatusSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string(),
  lastHeartbeatAt: z.string().nullable(),
  hubConnected: z.boolean(),
  error: z.string().nullable()
});
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;

export class LocalState {
  private readonly pendingPath: string;
  private readonly bindingsPath: string;
  private readonly daemonStatusPath: string;
  private readonly cursorsPath: string;
  private readonly inboxCachePath: string;

  constructor(configPath: string) {
    const directory = stateDirectory(configPath);
    this.pendingPath = path.join(directory, "pending-registrations.json");
    this.bindingsPath = path.join(directory, "bindings.json");
    this.daemonStatusPath = path.join(directory, "daemon-status.json");
    this.cursorsPath = path.join(directory, "inbox-cursors.json");
    this.inboxCachePath = path.join(directory, "inbox-cache.json");
  }

  listPending(): PendingRegistration[] {
    return this.readArray(this.pendingPath, PendingRegistrationSchema);
  }

  savePending(pending: PendingRegistration): void {
    const active = this.listPending().filter(item => Date.parse(item.expiresAt) > Date.now());
    const withoutSameChallenge = active.filter(item => item.challenge !== pending.challenge);
    atomicWriteJson(this.pendingPath, [...withoutSameChallenge, pending]);
  }

  getPending(challenge: string): PendingRegistration | undefined {
    return this.listPending().find(item => item.challenge === challenge);
  }

  removePending(challenge: string): void {
    atomicWriteJson(
      this.pendingPath,
      this.listPending().filter(item => item.challenge !== challenge)
    );
  }

  listBindings(): LocalBinding[] {
    return this.readArray(this.bindingsPath, LocalBindingSchema);
  }

  saveBinding(binding: LocalBinding): void {
    const existing = this.listBindings();
    const withoutSameBinding = existing.filter(item =>
      item.sessionBindingRef !== binding.sessionBindingRef
      && item.agentId !== binding.agentId
    );
    atomicWriteJson(this.bindingsPath, [...withoutSameBinding, binding]);
  }

  findBinding(sessionBindingRef: string): LocalBinding | undefined {
    return this.listBindings().find(item => item.sessionBindingRef === sessionBindingRef);
  }

  readDaemonStatus(): DaemonStatus | undefined {
    if (!existsSync(this.daemonStatusPath)) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(this.daemonStatusPath, "utf8"));
    const result = DaemonStatusSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  }

  writeDaemonStatus(status: DaemonStatus): void {
    atomicWriteJson(this.daemonStatusPath, status);
  }

  readCursor(agentId: string): number {
    if (!existsSync(this.cursorsPath)) return 0;
    const parsed: unknown = JSON.parse(readFileSync(this.cursorsPath, "utf8"));
    const result = z.record(z.string(), z.number().int().min(0)).safeParse(parsed);
    return result.success ? result.data[agentId] ?? 0 : 0;
  }

  writeCursor(agentId: string, sequence: number): void {
    let cursors: Record<string, number> = {};
    if (existsSync(this.cursorsPath)) {
      const parsed = z.record(z.string(), z.number().int().min(0)).safeParse(
        JSON.parse(readFileSync(this.cursorsPath, "utf8"))
      );
      if (parsed.success) cursors = parsed.data;
    }
    cursors[agentId] = sequence;
    atomicWriteJson(this.cursorsPath, cursors);
  }

  cacheMessages(agentId: string, messages: MessageRecord[]): void {
    let cache: Record<string, MessageRecord[]> = {};
    if (existsSync(this.inboxCachePath)) {
      const raw: unknown = JSON.parse(readFileSync(this.inboxCachePath, "utf8"));
      if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
        cache = raw as Record<string, MessageRecord[]>;
      }
    }
    const current = cache[agentId] ?? [];
    const byId = new Map(current.map(message => [message.messageId, message]));
    for (const message of messages) byId.set(message.messageId, message);
    cache[agentId] = [...byId.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-500);
    atomicWriteJson(this.inboxCachePath, cache);
  }

  private readArray<T>(filePath: string, schema: z.ZodType<T>): T[] {
    if (!existsSync(filePath)) return [];
    const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return z.array(schema).parse(raw);
  }
}
