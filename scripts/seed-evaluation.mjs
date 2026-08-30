const baseUrl = (process.env.AGENTHUB_HUB_URL || "http://127.0.0.1:4310").replace(/\/$/, "");
const token = process.env.AGENTHUB_TOKEN;
if (!token) throw new Error("AGENTHUB_TOKEN is required");

async function post(route, payload) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

const runnerA = "10000000-0000-4000-8000-000000000001";
const runnerB = "10000000-0000-4000-8000-000000000002";
const agents = {
  atlasBackend: "20000000-0000-4000-8000-000000000001",
  atlasFrontend: "20000000-0000-4000-8000-000000000002",
  atlasAlgorithm: "20000000-0000-4000-8000-000000000003",
  beaconBackend: "20000000-0000-4000-8000-000000000004",
  beaconFrontend: "20000000-0000-4000-8000-000000000005"
};

for (const runner of [
  { runnerId: runnerA, name: "Evaluation Windows", machineName: "eval-win", os: "win32-x64", version: "0.1.0" },
  { runnerId: runnerB, name: "Evaluation Mac", machineName: "eval-mac", os: "darwin-arm64", version: "0.1.0" }
]) {
  await post("/api/v1/runners/register", { ...runner, capabilities: ["stdio_mcp", "durable_inbox"] });
}

const agentRows = [
  [agents.atlasBackend, runnerA, "atlas", "backend", "Atlas Backend", "codex", "confirm_write", "1"],
  [agents.atlasFrontend, runnerB, "atlas", "frontend", "Atlas Frontend", "claude", "confirm_write", "2"],
  [agents.atlasAlgorithm, runnerA, "atlas", "algorithm", "Atlas Ranking", "codex", "full_auto", "3"],
  [agents.beaconBackend, runnerB, "beacon", "backend", "Beacon Backend", "claude", "full_auto", "4"],
  [agents.beaconFrontend, runnerA, "beacon", "frontend", "Beacon Frontend", "codex", "confirm_write", "5"]
];

for (const [agentId, runnerId, projectKey, role, displayName, provider, permissionMode, bindingDigit] of agentRows) {
  await post("/api/v1/agents/register", {
    agentId,
    idempotencyKey: `evaluation-register-${agentId}`,
    runnerId,
    projectKey,
    role,
    displayName,
    provider,
    repoFingerprint: (projectKey === "atlas" ? "a" : "b").repeat(64),
    sessionBindingRef: bindingDigit.repeat(64),
    sessionBindingStatus: "bound",
    permissionMode,
    capabilities: [role]
  });
}

const atlasConversation = "30000000-0000-4000-8000-000000000001";
const beaconConversation = "30000000-0000-4000-8000-000000000002";
const messages = [
  ["001", atlasConversation, agents.atlasBackend, [agents.atlasFrontend], "proposal", "Contract v1 returns display_name from GET /api/users/{id}."],
  ["002", atlasConversation, agents.atlasFrontend, [agents.atlasBackend], "objection", "The UI contract uses camel case; the response field must be displayName."],
  ["003", atlasConversation, agents.atlasBackend, [agents.atlasFrontend], "proposal", "Contract v2 returns displayName and keeps the endpoint unchanged."],
  ["004", atlasConversation, agents.atlasFrontend, [agents.atlasBackend], "approval", "Frontend approves contract v2 with displayName."],
  ["005", atlasConversation, agents.atlasBackend, [agents.atlasFrontend], "approval", "Backend approves contract v2 with displayName."],
  ["006", atlasConversation, agents.atlasBackend, [agents.atlasAlgorithm], "question", "Will renaming the serialized user field affect ranking inputs?"],
  ["007", atlasConversation, agents.atlasAlgorithm, [agents.atlasBackend], "result", "Ranking is unaffected because it consumes user_id only."],
  ["008", atlasConversation, agents.atlasFrontend, [agents.atlasBackend], "blocker", "Runtime evidence still shows display_name, so backend serialization remains blocked."],
  ["009", atlasConversation, agents.atlasBackend, [agents.atlasFrontend], "result", "Serializer fixed to displayName; pytest reports 18 passed."],
  ["010", beaconConversation, agents.beaconBackend, [agents.beaconFrontend], "proposal", "POST /imports accepts a source URL and starts one import job."],
  ["011", beaconConversation, agents.beaconFrontend, [agents.beaconBackend], "objection", "Retries can duplicate jobs; the request needs an idempotency key."],
  ["012", beaconConversation, agents.beaconBackend, [agents.beaconFrontend], "result", "The import contract now requires Idempotency-Key and reuses the original job." ]
];

for (const [suffix, conversationId, senderAgentId, recipientAgentIds, kind, text] of messages) {
  const messageId = `40000000-0000-4000-8000-000000000${suffix}`;
  await post("/api/v1/messages", {
    messageId,
    conversationId,
    senderAgentId,
    recipientAgentIds,
    kind,
    text,
    attachmentIds: [],
    idempotencyKey: `evaluation-message-${suffix}`
  });
}

process.stdout.write("Seeded deterministic AgentHub evaluation data.\n");
