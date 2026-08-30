# MCP evaluation fixture

The ten questions in `agenthub.xml` are independent and use read-only MCP tools. Their answers are stable only against the deterministic seed database.

1. Start Hub with a fresh database and explicit Token.
2. Set the same `AGENTHUB_TOKEN` and `AGENTHUB_HUB_URL`, then run `npm run seed:evaluation` once. The seed uses fixed IDs and idempotency keys, so retrying is safe.
3. Point an MCP evaluation client at `http://127.0.0.1:4310/mcp` with `Authorization: Bearer <token>`.
4. Run `evaluations/agenthub.xml` using only `agenthub_get_status`, `agenthub_list_agents`, and `agenthub_read_inbox`.

Do not seed a team or production database. The fixture contains synthetic Agents and messages.
