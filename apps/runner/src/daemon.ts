import type { RunnerConfig } from "./config.js";
import { HubClient } from "./hub-client.js";
import { runnerRegistration } from "./runner-info.js";
import { LocalState, type DaemonStatus } from "./state.js";

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function runDaemon(config: RunnerConfig, state: LocalState, hub: HubClient): Promise<void> {
  const startedAt = new Date().toISOString();
  let stopping = false;
  const stop = (): void => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const writeStatus = (patch: Partial<DaemonStatus>): void => {
    const previous = state.readDaemonStatus();
    state.writeDaemonStatus({
      pid: process.pid,
      startedAt: previous?.pid === process.pid ? previous.startedAt : startedAt,
      lastHeartbeatAt: patch.lastHeartbeatAt ?? previous?.lastHeartbeatAt ?? null,
      hubConnected: patch.hubConnected ?? previous?.hubConnected ?? false,
      error: patch.error === undefined ? previous?.error ?? null : patch.error
    });
  };

  writeStatus({ hubConnected: false, error: null });
  while (!stopping) {
    try {
      await hub.registerRunner(runnerRegistration(config));
      const bindings = state.listBindings();
      await hub.heartbeat(config.runnerId, {
        status: "online",
        agentIds: bindings.map(binding => binding.agentId)
      });

      for (const binding of bindings) {
        const cursor = state.readCursor(binding.agentId);
        const messages = await hub.readInbox(binding.agentId, cursor, 50);
        if (messages.length === 0) continue;
        state.cacheMessages(binding.agentId, messages);
        for (const message of messages) {
          await hub.acknowledgeMessage(message.messageId, binding.agentId, "delivered");
          console.error(`[AgentHub] ${binding.projectKey}/${binding.role} received ${message.kind} message ${message.messageId}`);
        }
        const last = messages.at(-1);
        if (last) state.writeCursor(binding.agentId, last.sequence);
      }

      writeStatus({
        lastHeartbeatAt: new Date().toISOString(),
        hubConnected: true,
        error: null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeStatus({ hubConnected: false, error: message });
      console.error(`[AgentHub] Runner heartbeat failed: ${message}`);
    }
    if (!stopping) await wait(config.heartbeatIntervalMs);
  }
}
