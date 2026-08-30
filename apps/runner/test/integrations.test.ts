import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installRegistrationSkills } from "../src/integrations.js";

test("Registration Skill installs for both providers without overwriting conflicts", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "agenthub-skills-test-"));
  const source = path.join(temporary, "source.md");
  const codexRoot = path.join(temporary, "codex");
  const claudeRoot = path.join(temporary, "claude");
  await writeFile(source, "---\nname: agenthub-register\n---\n");
  try {
    const first = installRegistrationSkills({ sourcePath: source, codexSkillsRoot: codexRoot, claudeSkillsRoot: claudeRoot });
    assert.deepEqual(first.map(item => item.status), ["installed", "installed"]);
    const second = installRegistrationSkills({ sourcePath: source, codexSkillsRoot: codexRoot, claudeSkillsRoot: claudeRoot });
    assert.deepEqual(second.map(item => item.status), ["unchanged", "unchanged"]);

    const target = path.join(codexRoot, "agenthub-register", "SKILL.md");
    await writeFile(target, "different");
    assert.throws(
      () => installRegistrationSkills({ sourcePath: source, codexSkillsRoot: codexRoot, claudeSkillsRoot: claudeRoot }),
      /Refusing to overwrite/
    );
    assert.equal(await readFile(target, "utf8"), "different");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
