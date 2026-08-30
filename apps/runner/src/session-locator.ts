import { createReadStream, existsSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Provider } from "@agenthub/shared";

export interface LocatedSession {
  provider: Provider;
  providerSessionId: string;
  transcriptPath: string;
  sessionCwd?: string;
}

export interface SessionRoots {
  codex?: string;
  claude?: string;
}

function defaultRoot(provider: Provider): string {
  return provider === "codex"
    ? path.join(os.homedir(), ".codex", "sessions")
    : path.join(os.homedir(), ".claude", "projects");
}

async function listJsonlFiles(root: string, limit = 5_000): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(absolutePath);
      if (files.length > limit) {
        throw new Error(`Session discovery exceeded ${limit} transcript files; use local manual binding`);
      }
    }
  }
  return files;
}

async function containsText(filePath: string, needle: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    let tail = "";
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      stream.destroy();
      resolve(value);
    };
    stream.on("data", chunk => {
      const text = tail + chunk;
      if (text.includes(needle)) {
        finish(true);
        return;
      }
      tail = text.slice(-Math.max(needle.length - 1, 0));
    });
    stream.on("end", () => finish(false));
    stream.on("error", error => {
      if (!settled) reject(error);
    });
  });
}

async function firstLine(filePath: string): Promise<string> {
  const handle = await open(filePath, "r");
  const chunks: Buffer[] = [];
  let position = 0;
  try {
    while (position <= 4 * 1024 * 1024) {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      const newline = chunk.indexOf(0x0a);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline));
        return Buffer.concat(chunks).toString("utf8");
      }
      chunks.push(chunk);
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  if (position > 4 * 1024 * 1024) {
    throw new Error(`Session metadata line is unexpectedly large: ${filePath}`);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeForCompare(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInsideWorkspace(workspaceRoot: string, candidate: string): boolean {
  const root = normalizeForCompare(workspaceRoot);
  const current = normalizeForCompare(candidate);
  const relative = path.relative(root, current);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function expectedClaudeDirectory(workspaceRoot: string): string {
  return workspaceRoot.replace(/[:\\/]/g, "-");
}

async function parseCodexSession(filePath: string, workspaceRoot: string): Promise<LocatedSession | undefined> {
  const metadata = JSON.parse(await firstLine(filePath)) as {
    payload?: { session_id?: unknown; id?: unknown; cwd?: unknown };
  };
  const providerSessionId = metadata.payload?.session_id ?? metadata.payload?.id;
  const cwd = metadata.payload?.cwd;
  if (typeof providerSessionId !== "string" || typeof cwd !== "string") return undefined;
  if (!isInsideWorkspace(workspaceRoot, cwd)) {
    throw new Error("The challenge was found in a Codex task bound to a different workspace");
  }
  return { provider: "codex", providerSessionId, transcriptPath: filePath, sessionCwd: cwd };
}

function parseClaudeSession(filePath: string, workspaceRoot: string): LocatedSession {
  const expectedDirectory = expectedClaudeDirectory(path.resolve(workspaceRoot));
  if (path.basename(path.dirname(filePath)) !== expectedDirectory) {
    throw new Error("The challenge was found in a Claude session bound to a different workspace");
  }
  return {
    provider: "claude",
    providerSessionId: path.basename(filePath, ".jsonl"),
    transcriptPath: filePath
  };
}

export async function locateSessionByChallenge(
  provider: Provider,
  challenge: string,
  workspaceRoot: string,
  createdAt: string,
  roots: SessionRoots = {}
): Promise<LocatedSession> {
  if (!/^ahb_bind_[a-f0-9-]{36}$/.test(challenge)) {
    throw new Error("Invalid AgentHub registration challenge");
  }
  const root = roots[provider] ?? defaultRoot(provider);
  const cutoff = Date.parse(createdAt) - 60_000;
  const files = await listJsonlFiles(root);
  const recent: string[] = [];
  for (const file of files) {
    const details = await stat(file);
    if (details.mtimeMs >= cutoff) recent.push(file);
  }

  const matches: LocatedSession[] = [];
  for (const file of recent) {
    if (!await containsText(file, challenge)) continue;
    const located = provider === "codex"
      ? await parseCodexSession(file, workspaceRoot)
      : parseClaudeSession(file, workspaceRoot);
    if (located) matches.push(located);
  }

  if (matches.length === 0) {
    throw new Error("Could not bind the current session. Ensure complete_registration is called from the same task immediately after begin_registration.");
  }
  if (matches.length > 1) {
    throw new Error("Registration challenge appeared in multiple provider sessions; start registration again to avoid an ambiguous binding");
  }
  const match = matches[0];
  if (!match) throw new Error("Session binding failed unexpectedly");
  return match;
}
