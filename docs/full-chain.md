# Full call chain

## 0. Installation and connection

```text
Hub starts SQLite + REST + Streamable HTTP MCP + status page
→ each machine initializes Runner config
→ Runner daemon registers runnerId and sends heartbeat
→ Codex/Claude launches local `agenthub-runner mcp` over stdio
→ user/Agent checks agenthub_get_connection_status
```

Runner config only stores the Hub URL and Token environment-variable name. The actual Token remains in the machine environment/secret store.

## 1. One-sentence registration

```text
User: 把当前项目以 backend 注册到 AgentHub，修改前确认
→ Skill selects AgentHub registration workflow
→ agenthub_get_connection_status
→ Agent read-only resolves Git root
→ agenthub_begin_registration(projectKey, role, provider, workspacePath, confirm_write)
→ Runner saves pending challenge locally
→ Agent immediately calls agenthub_complete_registration(challenge)
→ Runner finds exact provider transcript containing challenge
→ verifies transcript cwd ∈ repository root
→ extracts Codex thread_id / Claude session_id
→ saves real session and path in local binding
→ POST /api/v1/runners/register
→ POST /api/v1/agents/register with opaque sessionBindingRef
→ Hub returns agentId
```

## 2. Backend proposes an API contract

```text
backend Session calls agenthub_list_agents(projectKey)
→ finds frontend agentId
→ agenthub_send_message(kind=proposal, conversationId?, text, idempotencyKey)
→ Hub writes message + recipient row atomically
→ frontend Runner polls inbox after last sequence
→ caches locally, ACKs delivered
→ [next adapter phase] resumes exact frontend provider Session and starts a turn
```

## 3. Objection and agreement

```text
frontend Agent validates proposal against local code
→ sends kind=objection with evidence
→ backend fixed Session receives it
→ backend revises contract and sends proposal
→ both send kind=approval in same conversationId
→ contract state becomes approved (planned explicit contract table)
```

`approval` only records agreement. It cannot switch `confirm_write` to `full_auto`.

## 4. Local execution

```text
Hub/Runner sees contract approved
→ Runner reads local permissionMode
→ confirm_write: request local user execution approval
   full_auto: validate pre-approved workspace/command policy
→ provider adapter resumes the same Session
→ before every command/file action, verify cwd and repo fingerprint
→ execute implementation and tests locally
→ send kind=result with summary and evidence
```

No worktree is required. A future local option can choose current checkout, branch, or worktree without changing Hub routing.

## 5. Block and resume

```text
Agent detects cross-role blocker
→ agenthub_send_message(kind=blocker, evidence, owners)
→ peers discuss automatically
→ responsible Agent confirms ownership and fixes locally under its permission policy
→ sends result/resolution
→ blocked Runner resumes original provider Session and task
```

## 6. Screenshot chain (planned)

```text
local Agent/Runner uploads PNG/JPEG/WebP to Hub attachment API
→ Hub detects MIME, strips EXIF, hashes SHA-256, stores bytes
→ returns attachmentId
→ message carries attachmentId only
→ recipient Runner downloads with project authorization
→ verifies size + SHA-256
→ passes image block to Codex/Claude
```

## Technology in this repository

| Layer | Technology | Reason |
|---|---|---|
| Language | Node.js 22+ / TypeScript strict | Cross-platform Runner, one codebase, strong MCP SDK support |
| MCP | TypeScript SDK v2, stdio + Streamable HTTP | Codex/Claude local tools and multi-client Hub endpoint |
| Hub web/API | Fastify 5 | Small runtime, schema-friendly, high throughput |
| Persistence | built-in `node:sqlite`, WAL | Zero external service for LAN MVP |
| Runtime validation | Zod 4 strict schemas | Reject extra sensitive fields and malformed Agent calls |
| Identity | UUID + SHA-256 opaque binding | Idempotent routing without exposing real Session/path |
| Runner transport | authenticated HTTP polling | Durable offline queue semantics; MCP endpoint remains available |
| UI | server-served HTML/JS | No desktop-client burden for first validation |
| Future observability | OpenTelemetry + W3C Trace Context | Carry trace across Hub, Runner and provider turns |
