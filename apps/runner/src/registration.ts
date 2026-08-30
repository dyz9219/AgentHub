import { createHash, randomUUID } from "node:crypto";
import type { AgentRecord, BeginRegistrationInput } from "@agenthub/shared";
import type { RunnerConfig } from "./config.js";
import { HubClient } from "./hub-client.js";
import { inspectRepository } from "./repository.js";
import { runnerRegistration } from "./runner-info.js";
import { locateSessionByChallenge, type SessionRoots } from "./session-locator.js";
import { LocalState, type LocalBinding, type PendingRegistration } from "./state.js";

export interface BeginRegistrationResult {
  challenge: string;
  expiresAt: string;
  workspaceKind: "git" | "directory";
  remotePresent: boolean;
  nextAction: string;
}

export interface CompleteRegistrationResult {
  agent: AgentRecord;
  local: {
    sessionBound: true;
    workspaceBound: true;
    permissionMode: "confirm_write" | "full_auto";
  };
}

export class RegistrationService {
  constructor(
    private readonly config: RunnerConfig,
    private readonly state: LocalState,
    private readonly hub: HubClient,
    private readonly roots: SessionRoots = {}
  ) {}

  begin(input: BeginRegistrationInput): BeginRegistrationResult {
    const repository = inspectRepository(input.workspacePath);
    const challenge = `ahb_bind_${randomUUID()}`;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 5 * 60_000);
    const pending: PendingRegistration = {
      challenge,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      workspaceRoot: repository.workspaceRoot,
      repoFingerprint: repository.fingerprint,
      draft: input
    };
    this.state.savePending(pending);
    return {
      challenge,
      expiresAt: pending.expiresAt,
      workspaceKind: repository.kind,
      remotePresent: repository.remotePresent,
      nextAction: "Call agenthub_complete_registration with this exact challenge now, from the same Agent task. Do not ask the user to copy it."
    };
  }

  async complete(challenge: string): Promise<CompleteRegistrationResult> {
    const pending = this.state.getPending(challenge);
    if (!pending) {
      throw new Error("Registration challenge was not found or has expired; call agenthub_begin_registration again");
    }
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      this.state.removePending(challenge);
      throw new Error("Registration challenge expired; call agenthub_begin_registration again from the current task");
    }

    const session = await locateSessionByChallenge(
      pending.draft.provider,
      challenge,
      pending.workspaceRoot,
      pending.createdAt,
      this.roots
    );
    const sessionBindingRef = createHash("sha256")
      .update(`${this.config.runnerId}\0${session.provider}\0${session.providerSessionId}`)
      .digest("hex");
    const existing = this.state.findBinding(sessionBindingRef);
    const agentId = existing?.agentId ?? randomUUID();

    await this.hub.registerRunner(runnerRegistration(this.config));
    const agent = await this.hub.registerAgent({
      agentId,
      idempotencyKey: `register:${sessionBindingRef}:${pending.draft.projectKey}:${pending.draft.role}`,
      runnerId: this.config.runnerId,
      projectKey: pending.draft.projectKey,
      role: pending.draft.role,
      displayName: pending.draft.displayName,
      provider: pending.draft.provider,
      repoFingerprint: pending.repoFingerprint,
      sessionBindingRef,
      sessionBindingStatus: "bound",
      permissionMode: pending.draft.permissionMode,
      capabilities: pending.draft.capabilities
    });
    const now = new Date().toISOString();
    const binding: LocalBinding = {
      agentId: agent.agentId,
      runnerId: this.config.runnerId,
      projectKey: pending.draft.projectKey,
      role: pending.draft.role,
      displayName: pending.draft.displayName,
      provider: pending.draft.provider,
      providerSessionId: session.providerSessionId,
      workspacePath: pending.workspaceRoot,
      repoFingerprint: pending.repoFingerprint,
      sessionBindingRef,
      permissionMode: pending.draft.permissionMode,
      capabilities: pending.draft.capabilities,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.state.saveBinding(binding);
    this.state.removePending(challenge);
    return {
      agent,
      local: {
        sessionBound: true,
        workspaceBound: true,
        permissionMode: pending.draft.permissionMode
      }
    };
  }
}
