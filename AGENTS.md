# AgentHub project rules

AgentHub is a lightweight LAN coordination layer for local coding agents.

## Product boundary

- Agents communicate through a local Runner. Never expose Codex App Server, Claude Code, provider credentials, local session IDs, or absolute workspace paths to the LAN.
- Hub stores routing, durable messages, approvals, attachment metadata, and audit events. It does not execute repository commands.
- Runner owns provider sessions, local workspace paths, permission policy, provider invocation, and code execution.
- `approve_contract` means agents agree on a plan. It never grants local write permission.
- `confirm_write` requires a local user approval before a code mutation. `full_auto` is valid only inside the locally configured workspace and policy.
- Worktrees are optional and selected per Runner; the default is the current checkout.

## Engineering rules

- TypeScript must compile in strict mode. Do not use `any`; validate external input with Zod.
- MCP tools use the `agenthub_` prefix, precise descriptions, output schemas where practical, and correct annotations.
- stdout is reserved for the MCP stdio protocol. Runner diagnostics go to stderr.
- Network operations need authentication, bounded payloads, timeouts, actionable errors, and idempotency where retries are expected.
- Provider session IDs and absolute paths must remain in Runner-local state. Hub receives only opaque binding references and repository fingerprints.
- Never infer a provider session from the most recently used conversation. Bind by host metadata, a unique challenge marker, or explicit local selection.
- Add or update tests for registration, routing, permissions, persistence, and session binding changes.

## Verification

Run from the repository root:

```text
npm run build
npm test
npm run smoke
```
