import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface RepositoryIdentity {
  workspaceRoot: string;
  fingerprint: string;
  kind: "git" | "directory";
  remotePresent: boolean;
}

function runGit(workspacePath: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", workspacePath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      windowsHide: true
    }).trim();
  } catch {
    return undefined;
  }
}

function normalizeRemote(remote: string): string {
  return remote.trim().replace(/\.git$/i, "").replace(/\\/g, "/").toLowerCase();
}

export function inspectRepository(workspacePath: string): RepositoryIdentity {
  if (!path.isAbsolute(workspacePath)) {
    throw new Error("workspacePath must be absolute; use the exact current project path");
  }
  if (!existsSync(workspacePath) || !statSync(workspacePath).isDirectory()) {
    throw new Error(`workspacePath is not an existing directory: ${workspacePath}`);
  }
  const canonicalPath = realpathSync.native(workspacePath);
  const gitRoot = runGit(canonicalPath, ["rev-parse", "--show-toplevel"]);
  if (gitRoot) {
    const workspaceRoot = realpathSync.native(gitRoot);
    const remote = runGit(workspaceRoot, ["remote", "get-url", "origin"]);
    const identity = remote
      ? `git-remote:${normalizeRemote(remote)}`
      : `git-local:${path.basename(workspaceRoot).toLowerCase()}`;
    return {
      workspaceRoot,
      fingerprint: createHash("sha256").update(identity).digest("hex"),
      kind: "git",
      remotePresent: Boolean(remote)
    };
  }
  return {
    workspaceRoot: canonicalPath,
    fingerprint: createHash("sha256")
      .update(`directory:${path.basename(canonicalPath).toLowerCase()}`)
      .digest("hex"),
    kind: "directory",
    remotePresent: false
  };
}
