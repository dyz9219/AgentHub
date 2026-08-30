---
name: agenthub-register
description: Register or connect the exact current Codex/Claude project task to AgentHub when the user asks to register this Agent, project, role, workspace, session, or connect to AgentHub. Also use to check AgentHub connection status. Registration is communication setup only and never authorizes code changes.
---

# AgentHub current-task registration

Use the local AgentHub Runner MCP tools. Do not edit repository files during registration.

## Workflow

1. Call `agenthub_get_connection_status`.
   - If Hub is unreachable or Runner is uninitialized, report the exact returned fix and stop.
   - A stopped daemon does not block interactive registration, but clearly report that asynchronous delivery needs the daemon.
2. Read-only verify the current absolute workspace and Git root. Never infer a different repository from conversation text.
3. Resolve registration values:
   - `projectKey`: shared project name from the user or unambiguous repository name.
   - `role`: user-specified responsibility such as frontend, backend, algorithm, product, or ui.
   - `displayName`: short project/role label.
   - `provider`: the actual current host, `codex` or `claude`.
   - `permissionMode`: default `confirm_write`; use `full_auto` only when explicitly requested.
4. Call `agenthub_begin_registration` with those values and the verified absolute workspace path.
5. Immediately call `agenthub_complete_registration` in this same task with the exact returned challenge.
   - Do not ask the user to copy it.
   - Do not alter it, guess a session ID, choose the most recent session, or expose credentials.
6. Report only the returned Agent ID, project key, role, binding state, Hub state, daemon state, and permission mode. Never print provider session IDs, transcript paths, tokens, or private local paths.

If binding fails due to zero matches, ambiguity, expiry, or cwd mismatch, follow the Runner error and restart registration. Never bypass the check.
