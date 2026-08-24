# Goal

The routine development path runs as a minimal three-agent loop:

- **Researcher** answers exactly one bounded research question per
  Lead-delegated task. It uses the installed local web-access
  provider (`pi-web-access`) for `web_search`, `fetch_content`,
  `get_search_content`, and `source_check`. It does not implement
  code, propose architecture, or chain multiple research questions.
  It persists one research artifact per task at
  `research/<task-id>-<slug>.md`.

- **Executor** implements exactly one Lead-delegated change inside
  the assigned isolated worktree. It uses the smallest coherent
  change, runs the project's validation commands, and persists
  `implementation_notes/<task-id>.md` with a stop signal. It does
  not refactor unrelated code, edit tests to hide failures, or
  commit without Lead authorization.

- **Reviewer** enters the paired worktree only after Executor has
  stopped. It reproduces validation, verifies scope, and (for real
  failures only) writes a failure artifact at
  `failures/<task-id>-<finding-id>.md`. It edits tests only to add
  regression coverage or to capture a real failure. It never edits
  production code.

- **Lead (Codex)** is the user-facing session that owns canonical
  state, assigns task IDs, and arbitrates decisions.

The path is fully traceable: every task has an ID supplied by Lead,
every artifact lands at a known project-root path, and every peer
exchange goes through the shared intercom implementation with
runtime policy enforcement. Application artifacts use human-readable
Lead task IDs and no content hashes. Transport correlation UUIDs remain
an internal intercom mechanism and are not application artifact IDs.
There is no Deep Research MCP, no cross-worktree scope, no
production-code edits by Reviewer, and no commits without Lead
authorization.
