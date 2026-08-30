#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultConfigPath,
  initializeRunner,
  loadRunnerConfig,
  tokenFor
} from "./config.js";
import { runDaemon } from "./daemon.js";
import { HubClient } from "./hub-client.js";
import { installRegistrationSkills } from "./integrations.js";
import { runMcpServer } from "./mcp.js";
import { RegistrationService } from "./registration.js";
import { LocalState } from "./state.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function help(): string {
  return `AgentHub Runner 0.1.0

Usage:
  agenthub-runner init --hub http://<hub-ip>:4310 [--name NAME] [--token-env AGENTHUB_TOKEN] [--skip-skills]
  agenthub-runner daemon
  agenthub-runner mcp
  agenthub-runner status [--json]

Runner is one install with three roles: a background daemon, a stdio MCP bridge, and this CLI.`;
}

function createServices(configPath: string) {
  const config = loadRunnerConfig(configPath);
  const state = new LocalState(configPath);
  const hub = new HubClient(config.hubUrl, tokenFor(config));
  const registration = new RegistrationService(config, state, hub);
  return { config, state, hub, registration };
}

async function status(configPath: string, json: boolean): Promise<void> {
  const config = loadRunnerConfig(configPath);
  const state = new LocalState(configPath);
  let hubConnected = false;
  let hubError: string | null = null;
  try {
    const hub = new HubClient(config.hubUrl, tokenFor(config));
    await hub.getStatus();
    hubConnected = true;
  } catch (error) {
    hubError = error instanceof Error ? error.message : String(error);
  }
  const daemon = state.readDaemonStatus();
  const daemonRunning = Boolean(
    daemon?.lastHeartbeatAt
    && Date.now() - Date.parse(daemon.lastHeartbeatAt) < config.heartbeatIntervalMs * 3
  );
  const value = {
    configPath,
    runnerId: config.runnerId,
    runnerName: config.runnerName,
    hubUrl: config.hubUrl,
    hubConnected,
    daemonRunning,
    daemon,
    bindings: state.listBindings().map(binding => ({
      agentId: binding.agentId,
      projectKey: binding.projectKey,
      role: binding.role,
      provider: binding.provider,
      permissionMode: binding.permissionMode,
      sessionBound: true
    })),
    error: hubError
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write([
    `Runner: ${value.runnerName} (${value.runnerId})`,
    `Hub: ${value.hubUrl} — ${hubConnected ? "connected" : "disconnected"}`,
    `Daemon: ${daemonRunning ? "running" : "not running"}`,
    `Bindings: ${value.bindings.length}`,
    ...(hubError ? [`Error: ${hubError}`] : [])
  ].join("\n") + "\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const configPath = path.resolve(option(args, "--config") ?? defaultConfigPath());

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${help()}\n`);
    return;
  }
  if (command === "init") {
    const hubUrl = option(args, "--hub") ?? process.env.AGENTHUB_HUB_URL;
    if (!hubUrl) throw new Error("init requires --hub http://<hub-ip>:4310");
    const runnerName = option(args, "--name");
    const tokenEnv = option(args, "--token-env");
    const initOptions: Parameters<typeof initializeRunner>[0] = { hubUrl, configPath };
    if (runnerName) initOptions.runnerName = runnerName;
    if (tokenEnv) initOptions.tokenEnv = tokenEnv;
    const initialized = initializeRunner(initOptions);
    const skillResults = args.includes("--skip-skills")
      ? []
      : installRegistrationSkills({ force: args.includes("--force-skills") });
    process.stdout.write([
      `Runner initialized: ${initialized.configPath}`,
      `Token source: environment variable ${initialized.config.tokenEnv}`,
      ...skillResults.map(item => `${item.host} Skill ${item.status}: ${item.target}`),
      "Start the daemon: agenthub-runner daemon",
      "Add local MCP to Codex: codex mcp add agenthub -- agenthub-runner mcp",
      "Add local MCP to Claude: claude mcp add -s user agenthub -- agenthub-runner mcp"
    ].join("\n") + "\n");
    return;
  }
  if (command === "status") {
    await status(configPath, args.includes("--json"));
    return;
  }

  const services = createServices(configPath);
  if (command === "daemon") {
    await runDaemon(services.config, services.state, services.hub);
    return;
  }
  if (command === "mcp") {
    await runMcpServer(services.config, services.state, services.hub, services.registration);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${help()}`);
}

main().catch(error => {
  const currentFile = fileURLToPath(import.meta.url);
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[${path.basename(currentFile)}] ${message}`);
  process.exitCode = 1;
});
