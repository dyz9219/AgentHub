# Validation plan

## Automated baseline already passing

Run `npm run build && npm test && npm run smoke`.

Current assertions:

- Hub schema rejects raw provider Session IDs and workspace paths.
- Runner/Agent registration and durable message inbox work in SQLite.
- Dashboard API requires bearer authentication.
- Codex challenge locates one exact transcript and verifies cwd.
- Claude challenge locates the exact workspace transcript.
- Duplicate challenge matches fail closed.
- Real Hub and Runner daemon processes connect; status API, dashboard API and HTTP MCP tool listing respond.

## Stage 1: same machine, local-to-local

Purpose: prove protocol and permissions before adding LAN variables.

Setup:

- Hub at `127.0.0.1:4310`.
- Backend Codex task in repository B.
- Frontend Claude or Codex task in repository F.
- One Runner daemon can host both local bindings; alternatively run two isolated Runner configs to exercise routing.

Scenarios:

1. Register both tasks by natural language; assert the page shows two Agents and one/two Runner(s).
2. Assert each registration returns the same provider Session on re-registration, without exposing its ID to Hub.
3. Backend sends proposal; frontend inbox receives one message with exact sequence.
4. Retry same idempotency key; assert no duplicate message.
5. Stop daemon, send message, restart daemon; assert queued delivery and no loss.
6. Set frontend `confirm_write`; send approved contract; assert zero repository changes before local execution approval.
7. Set an isolated test Runner `full_auto`; assert changes remain inside its configured repository.
8. Put one challenge into two fixture transcripts; assert registration rejects ambiguity.
9. After attachment API lands, transfer PNG/JPEG/WebP, wrong hash, oversized file and SVG rejection.

Pass gate: registration, durable delivery, Session continuity, write guard and restart recovery all pass.

## Stage 2: two LAN machines

Suggested role split:

- Machine A: Hub + backend Runner/Codex.
- Machine B: frontend Runner/Codex.

Read-only preflight on B:

- Verify OS/architecture, Node, Git, Codex login, target repository path and Hub TCP reachability.
- Verify Hub certificate/token/Host allow-list if HTTPS or named host is used.
- Do not copy account cookies, provider tokens or private keys between machines.

Scenarios:

1. B Runner actively connects to A Hub; no inbound Codex/Claude port on B.
2. Register frontend from its exact current task and verify only opaque binding appears on A.
3. Bidirectional proposal/objection/approval/result messages.
4. Disconnect network for two minutes, send messages, restore; assert ordered replay and idempotent ACK.
5. Restart Hub; assert SQLite persistence and Runner reconnect.
6. Use wrong Token and wrong Host; assert 401/403 without information leakage.
7. After provider adapters land, remotely trigger B's bound Session and verify a real file change only in B's test repository.

Pass gate: no message loss, no Session swap, no remote provider port, and repository effect is observable on the responsible machine.

## Stage 3: frontend/backend demo

Demo stack:

- Frontend: React/Vite.
- Backend: FastAPI + OpenAPI.
- Browser validation: Playwright.

Contract story:

```text
Backend proposes GET /api/users/{id} returning display_name
→ frontend objects: UI contract requires displayName
→ backend revises OpenAPI to displayName
→ both approve_contract
→ local approve_execution/full_auto gates pass
→ backend implements + pytest
→ frontend implements + component tests
→ services start
→ Playwright verifies the rendered user name
```

Fault-injection story:

- Backend intentionally returns `display_name`; frontend sends blocker with response evidence; backend accepts ownership and fixes.
- Then add a frontend mapping bug while backend is correct; system must assign frontend ownership. This prevents a hard-coded “API mismatch always belongs to backend” policy.

Evidence required for pass:

- Hub conversation and trace IDs.
- Both Agent approvals and separate local execution approvals.
- Fixed provider Session binding before and after blocker.
- Git diff on the correct machine only.
- Backend tests and Playwright result.
- No secrets, raw Session IDs or absolute paths in Hub database/export.
