import assert from "node:assert/strict";
import test from "node:test";
import { RegisterAgentRequestSchema, SendMessageRequestSchema } from "../src/index.js";

test("Hub registration rejects raw session IDs and workspace paths", () => {
  const result = RegisterAgentRequestSchema.safeParse({
    agentId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "registration-1",
    runnerId: "22222222-2222-4222-8222-222222222222",
    projectKey: "demo",
    role: "backend",
    displayName: "Backend",
    provider: "codex",
    repoFingerprint: "a".repeat(64),
    sessionBindingRef: "b".repeat(64),
    sessionBindingStatus: "bound",
    permissionMode: "confirm_write",
    capabilities: [],
    providerSessionId: "must-not-leave-runner",
    workspacePath: "E:\\secret"
  });

  assert.equal(result.success, false);
});

test("Messages require at least one recipient and bounded text", () => {
  const result = SendMessageRequestSchema.safeParse({
    senderAgentId: "11111111-1111-4111-8111-111111111111",
    recipientAgentIds: [],
    kind: "text",
    text: "hello",
    attachmentIds: [],
    idempotencyKey: "message-1"
  });

  assert.equal(result.success, false);
});
