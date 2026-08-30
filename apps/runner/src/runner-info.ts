import os from "node:os";
import type { RegisterRunnerRequest } from "@agenthub/shared";
import type { RunnerConfig } from "./config.js";

export const RUNNER_VERSION = "0.1.0";

export function runnerRegistration(config: RunnerConfig): RegisterRunnerRequest {
  return {
    runnerId: config.runnerId,
    name: config.runnerName,
    machineName: os.hostname(),
    os: `${process.platform}-${process.arch} ${os.release()}`,
    version: RUNNER_VERSION,
    capabilities: [
      "stdio_mcp",
      "durable_inbox",
      "codex_session_binding",
      "claude_session_binding",
      "confirm_write",
      "full_auto"
    ]
  };
}
