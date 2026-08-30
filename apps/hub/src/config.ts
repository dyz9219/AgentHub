import path from "node:path";

export interface HubConfig {
  host: string;
  port: number;
  token: string;
  allowedHosts: string[];
  databasePath: string;
  offlineAfterMs: number;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "4310");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("AGENTHUB_PORT must be an integer from 1 to 65535");
  }
  return parsed;
}

export function loadHubConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const host = env.AGENTHUB_HOST?.trim() || "127.0.0.1";
  const explicitToken = env.AGENTHUB_TOKEN?.trim();
  if (!LOOPBACK_HOSTS.has(host) && !explicitToken) {
    throw new Error("AGENTHUB_TOKEN is required when Hub binds beyond loopback");
  }

  const allowedHosts = (env.AGENTHUB_ALLOWED_HOSTS ?? "127.0.0.1,localhost")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  if (!LOOPBACK_HOSTS.has(host) && allowedHosts.length === 0) {
    throw new Error("AGENTHUB_ALLOWED_HOSTS is required for LAN binding");
  }

  return {
    host,
    port: parsePort(env.AGENTHUB_PORT),
    token: explicitToken || "agenthub-local-dev-token",
    allowedHosts,
    databasePath: path.resolve(env.AGENTHUB_DB_PATH?.trim() || "./data/agenthub.db"),
    offlineAfterMs: 45_000
  };
}
