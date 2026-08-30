import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const hubEntry = path.join(root, "apps", "hub", "dist", "index.js");
const runnerEntry = path.join(root, "apps", "runner", "dist", "index.js");
const evaluationSeedEntry = path.join(root, "scripts", "seed-evaluation.mjs");
const token = "agenthub-smoke-token";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function runNode(args, env, stdin = "ignore") {
  return spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: [stdin, "pipe", "pipe"],
    windowsHide: true
  });
}

async function command(args, env) {
  const child = runNode(args, env);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.once("exit", resolve));
  if (code !== 0) throw new Error(`Command failed (${code}): ${stderr || stdout}`);
  return { stdout, stderr };
}

async function waitFor(check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw lastError ?? new Error("Timed out waiting for smoke-test condition");
}

async function inspectRunnerMcp(configPath, env) {
  const child = runNode([runnerEntry, "mcp", "--config", configPath], env, "pipe");
  const pending = new Map();
  let buffer = "";
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.on("data", chunk => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });

  const call = (id, method, params) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Runner MCP ${method} timed out: ${stderr}`));
    }, 10_000);
    pending.set(id, {
      resolve: value => { clearTimeout(timeout); resolve(value); }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

  try {
    const initialized = await call(1, "initialize", {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "agenthub-smoke", version: "0.1.0" }
    });
    assert.ok(initialized.result, JSON.stringify(initialized));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = await call(2, "tools/list", {});
    const names = tools.result?.tools?.map(tool => tool.name) ?? [];
    assert.ok(names.includes("agenthub_begin_registration"));
    assert.ok(names.includes("agenthub_get_connection_status"));
  } finally {
    child.kill();
  }
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "agenthub-smoke-"));
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const configPath = path.join(temporary, "runner", "config.json");
const commonEnv = { AGENTHUB_TOKEN: token };
let hub;
let daemon;

try {
  hub = runNode([hubEntry], {
    ...commonEnv,
    AGENTHUB_HOST: "127.0.0.1",
    AGENTHUB_PORT: String(port),
    AGENTHUB_DB_PATH: path.join(temporary, "hub", "agenthub.db")
  });
  await waitFor(async () => (await fetch(`${baseUrl}/healthz`)).ok);

  await command([
    runnerEntry,
    "init",
    "--hub",
    baseUrl,
    "--name",
    "smoke-runner",
    "--skip-skills",
    "--config",
    configPath
  ], commonEnv);

  daemon = runNode([runnerEntry, "daemon", "--config", configPath], commonEnv);
  const status = await waitFor(async () => {
    const result = await command([runnerEntry, "status", "--json", "--config", configPath], commonEnv);
    const parsed = JSON.parse(result.stdout);
    return parsed.hubConnected && parsed.daemonRunning ? parsed : undefined;
  });
  assert.equal(status.runnerName, "smoke-runner");

  await inspectRunnerMcp(configPath, commonEnv);

  const dashboard = await fetch(`${baseUrl}/api/v1/dashboard`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(dashboard.status, 200);
  const dashboardData = await dashboard.json();
  assert.equal(dashboardData.status.runners.online, 1);

  const mcpResponse = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  assert.equal(mcpResponse.status, 200);
  const mcpText = await mcpResponse.text();
  assert.match(mcpText, /agenthub_get_status/);

  await command([evaluationSeedEntry], {
    ...commonEnv,
    AGENTHUB_HUB_URL: baseUrl
  });
  const listAgentsResponse = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "agenthub_list_agents", arguments: { projectKey: "atlas" } }
    })
  });
  assert.equal(listAgentsResponse.status, 200);
  const listAgentsText = await listAgentsResponse.text();
  assert.match(listAgentsText, /Atlas Backend/);
  assert.match(listAgentsText, /Atlas Frontend/);
  assert.match(listAgentsText, /Atlas Ranking/);

  process.stdout.write("AgentHub smoke test passed: Hub, daemon, status/dashboard APIs, Hub HTTP MCP tools, Runner stdio MCP, and evaluation seed are connected.\n");
} finally {
  if (daemon && !daemon.killed) daemon.kill();
  if (hub && !hub.killed) hub.kill();
  await new Promise(resolve => setTimeout(resolve, 300));
  await rm(temporary, { recursive: true, force: true });
}
