import assert from "node:assert/strict";
import test from "node:test";
import type { HubConfig } from "../src/config.js";
import { buildHubApp } from "../src/app.js";

const TOKEN = "test-agenthub-token";

function testConfig(): HubConfig {
  return {
    host: "127.0.0.1",
    port: 4310,
    token: TOKEN,
    allowedHosts: ["127.0.0.1", "localhost"],
    databasePath: ":memory:",
    offlineAfterMs: 45_000
  };
}

test("Runner and Agent registration feed a durable message inbox", async () => {
  const { app } = buildHubApp(testConfig());
  const headers = { authorization: `Bearer ${TOKEN}` };
  const runnerId = "11111111-1111-4111-8111-111111111111";
  const senderId = "22222222-2222-4222-8222-222222222222";
  const recipientId = "33333333-3333-4333-8333-333333333333";

  try {
    const runnerResponse = await app.inject({
      method: "POST",
      url: "/api/v1/runners/register",
      headers,
      payload: {
        runnerId,
        name: "test-runner",
        machineName: "test-machine",
        os: "test",
        version: "0.1.0",
        capabilities: ["mcp"]
      }
    });
    assert.equal(runnerResponse.statusCode, 200);

    for (const [agentId, role, binding] of [
      [senderId, "backend", "a".repeat(64)],
      [recipientId, "frontend", "b".repeat(64)]
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/agents/register",
        headers,
        payload: {
          agentId,
          idempotencyKey: `register-${agentId}`,
          runnerId,
          projectKey: "demo",
          role,
          displayName: role,
          provider: "codex",
          repoFingerprint: "c".repeat(64),
          sessionBindingRef: binding,
          sessionBindingStatus: "bound",
          permissionMode: "confirm_write",
          capabilities: []
        }
      });
      assert.equal(response.statusCode, 200, response.body);
    }

    const messageResponse = await app.inject({
      method: "POST",
      url: "/api/v1/messages",
      headers,
      payload: {
        senderAgentId: senderId,
        recipientAgentIds: [recipientId],
        kind: "proposal",
        text: "Use displayName in the contract",
        attachmentIds: [],
        idempotencyKey: "message-contract-proposal"
      }
    });
    assert.equal(messageResponse.statusCode, 200, messageResponse.body);

    const inboxResponse = await app.inject({
      method: "GET",
      url: `/api/v1/inbox?agentId=${recipientId}&after=0&limit=20`,
      headers
    });
    assert.equal(inboxResponse.statusCode, 200, inboxResponse.body);
    const body = inboxResponse.json() as { messages: Array<{ text: string; sequence: number }> };
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0]?.text, "Use displayName in the contract");
    assert.equal(body.messages[0]?.sequence, 1);
  } finally {
    await app.close();
  }
});

test("Dashboard data requires authentication", async () => {
  const { app } = buildHubApp(testConfig());
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/dashboard" });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
