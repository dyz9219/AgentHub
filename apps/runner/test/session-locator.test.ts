import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { locateSessionByChallenge } from "../src/session-locator.js";

const CHALLENGE = "ahb_bind_11111111-1111-4111-8111-111111111111";

test("Codex challenge binds the exact transcript and validates cwd", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "agenthub-runner-test-"));
  const workspace = path.join(temporary, "repo");
  const sessions = path.join(temporary, "codex", "2026", "08", "30");
  await mkdir(workspace, { recursive: true });
  await mkdir(sessions, { recursive: true });
  const transcript = path.join(sessions, "rollout.jsonl");
  await writeFile(transcript, [
    JSON.stringify({ type: "session_meta", payload: { session_id: "codex-thread-1", cwd: workspace } }),
    JSON.stringify({ type: "tool_result", payload: { text: CHALLENGE } })
  ].join("\n"));

  try {
    const located = await locateSessionByChallenge(
      "codex",
      CHALLENGE,
      workspace,
      new Date(Date.now() - 1_000).toISOString(),
      { codex: path.join(temporary, "codex") }
    );
    assert.equal(located.providerSessionId, "codex-thread-1");
    assert.equal(located.sessionCwd, workspace);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Claude challenge binds the transcript filename within the encoded workspace", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "agenthub-runner-test-"));
  const workspace = path.join(temporary, "repo");
  const encoded = path.resolve(workspace).replace(/[:\\/]/g, "-");
  const projectDirectory = path.join(temporary, "claude", encoded);
  await mkdir(workspace, { recursive: true });
  await mkdir(projectDirectory, { recursive: true });
  const transcript = path.join(projectDirectory, "claude-session-1.jsonl");
  await writeFile(transcript, JSON.stringify({ sessionId: "claude-session-1", content: CHALLENGE }));

  try {
    const located = await locateSessionByChallenge(
      "claude",
      CHALLENGE,
      workspace,
      new Date(Date.now() - 1_000).toISOString(),
      { claude: path.join(temporary, "claude") }
    );
    assert.equal(located.providerSessionId, "claude-session-1");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("A challenge in two transcripts is rejected as ambiguous", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "agenthub-runner-test-"));
  const workspace = path.join(temporary, "repo");
  const sessions = path.join(temporary, "codex");
  await mkdir(workspace, { recursive: true });
  await mkdir(sessions, { recursive: true });
  for (const id of ["one", "two"]) {
    await writeFile(path.join(sessions, `${id}.jsonl`), [
      JSON.stringify({ type: "session_meta", payload: { session_id: id, cwd: workspace } }),
      CHALLENGE
    ].join("\n"));
  }
  try {
    await assert.rejects(
      locateSessionByChallenge(
        "codex",
        CHALLENGE,
        workspace,
        new Date(Date.now() - 1_000).toISOString(),
        { codex: sessions }
      ),
      /multiple provider sessions/
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
