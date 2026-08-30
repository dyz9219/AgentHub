import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillInstallOptions {
  sourcePath?: string;
  codexSkillsRoot?: string;
  claudeSkillsRoot?: string;
  force?: boolean;
}

function discoverSource(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDirectory, "../../../skills/agenthub-register/SKILL.md"),
    path.resolve(moduleDirectory, "../assets/agenthub-register/SKILL.md")
  ];
  const source = candidates.find(candidate => existsSync(candidate));
  if (!source) {
    throw new Error("Bundled agenthub-register Skill was not found; reinstall Runner or use --skip-skills");
  }
  return source;
}

function installOne(source: string, target: string, force: boolean): "installed" | "unchanged" | "updated" {
  const content = readFileSync(source, "utf8");
  if (existsSync(target)) {
    const existing = readFileSync(target, "utf8");
    if (existing === content) return "unchanged";
    if (!force) {
      throw new Error(`Refusing to overwrite a different Skill at ${target}; rerun with --force-skills after review`);
    }
  }
  const existed = existsSync(target);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, { encoding: "utf8", mode: 0o600 });
  return existed ? "updated" : "installed";
}

export function installRegistrationSkills(options: SkillInstallOptions = {}): Array<{
  host: "codex" | "claude";
  target: string;
  status: "installed" | "unchanged" | "updated";
}> {
  const source = path.resolve(options.sourcePath ?? discoverSource());
  const codexRoot = path.resolve(options.codexSkillsRoot ?? path.join(os.homedir(), ".agents", "skills"));
  const claudeRoot = path.resolve(options.claudeSkillsRoot ?? path.join(os.homedir(), ".claude", "skills"));
  const targets = [
    { host: "codex" as const, target: path.join(codexRoot, "agenthub-register", "SKILL.md") },
    { host: "claude" as const, target: path.join(claudeRoot, "agenthub-register", "SKILL.md") }
  ];
  return targets.map(item => ({
    ...item,
    status: installOne(source, item.target, options.force ?? false)
  }));
}
