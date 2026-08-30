import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as z from "zod/v4";

const RunnerConfigSchema = z.object({
  runnerId: z.uuid(),
  runnerName: z.string().trim().min(1).max(100),
  hubUrl: z.url(),
  tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  heartbeatIntervalMs: z.number().int().min(5_000).max(300_000)
}).strict();

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AGENTHUB_CONFIG?.trim()) {
    return path.resolve(env.AGENTHUB_CONFIG.trim());
  }
  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData) {
      return path.join(localAppData, "AgentHub", "config.json");
    }
  }
  return path.join(os.homedir(), ".config", "agenthub", "config.json");
}

export function loadRunnerConfig(configPath = defaultConfigPath()): RunnerConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Runner is not initialized. Run: agenthub-runner init --hub http://<hub-ip>:4310`);
  }
  const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  return RunnerConfigSchema.parse(raw);
}

export interface InitRunnerOptions {
  hubUrl: string;
  runnerName?: string;
  tokenEnv?: string;
  configPath?: string;
}

export function initializeRunner(options: InitRunnerOptions): { config: RunnerConfig; configPath: string } {
  const configPath = path.resolve(options.configPath ?? defaultConfigPath());
  let runnerId: string = randomUUID();
  if (existsSync(configPath)) {
    const existing = RunnerConfigSchema.safeParse(JSON.parse(readFileSync(configPath, "utf8")));
    if (existing.success) {
      runnerId = existing.data.runnerId;
    }
  }
  const config = RunnerConfigSchema.parse({
    runnerId,
    runnerName: options.runnerName?.trim() || os.hostname(),
    hubUrl: options.hubUrl.replace(/\/$/, ""),
    tokenEnv: options.tokenEnv?.trim() || "AGENTHUB_TOKEN",
    heartbeatIntervalMs: 15_000
  });
  atomicWriteJson(configPath, config);
  return { config, configPath };
}

export function tokenFor(config: RunnerConfig, env: NodeJS.ProcessEnv = process.env): string {
  const token = env[config.tokenEnv]?.trim();
  if (!token) {
    throw new Error(`Environment variable ${config.tokenEnv} must contain the AgentHub token`);
  }
  return token;
}

export function stateDirectory(configPath = defaultConfigPath()): string {
  return path.dirname(path.resolve(configPath));
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, filePath);
}
