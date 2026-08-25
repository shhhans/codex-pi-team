# Goal

The stable Windows-native entrypoint is `pi-team.cmd`; its operational
contract is recorded in `ADR/0003-stable-pi-team-entrypoint.md` and the
implementation plan in `plans/pi-team-stable-entry.md`.

`ADR/0002-lead-subagent-collaboration-protocol.md` is the sole normative
collaboration protocol; this file states its operational goal.

The routine development path runs as a minimal three-agent loop:

- **Researcher** answers exactly one bounded research question per
  Lead-delegated task. It uses the user-shared, role-scoped web-access
  provider (`pi-web-access`) for `web_search`, `fetch_content`,
  `get_search_content`, and `source_check`. It does not implement
  code, propose architecture, or chain multiple research questions.
  It persists one research artifact per task at
  `research/<task-id>-<slug>.md`.

- **Executor** implements exactly one Lead-delegated change inside
  the assigned isolated worktree. It uses the smallest coherent
  change, runs the project's validation commands, and persists
  `implementation_notes/<task-id>.md`. It reports each completed slice
  and becomes idle while remaining allocated through review/fix. It does
  not refactor unrelated code, edit tests to hide failures, or
  commit without Lead authorization.

- **Reviewer** is allocated one-to-one with Executor and waits idle for
  `READY_FOR_REVIEW` or `FIX_READY`. It reproduces validation, verifies
  scope, and (for real
  failures only) writes a failure artifact at
  `failures/<task-id>-<finding-id>.md`. It edits tests only to add
  regression coverage or to capture a real failure. It never edits
  production code.

- **Lead (Codex)** is the user-facing session that owns canonical
  state; owns each task's ID, name, description, scope, done criteria,
  pairing, acceptance, and reclamation; and arbitrates decisions with
  the User.

The path is fully traceable: every task has an ID supplied by Lead,
every artifact lands at a known project-root path, and every peer
exchange goes through the shared intercom implementation with
runtime policy enforcement. Application artifacts use human-readable
Lead task IDs and no content hashes. Transport correlation UUIDs remain
an internal intercom mechanism and are not application artifact IDs.
There is no Deep Research MCP, no cross-worktree scope, no
production-code edits by Reviewer, no normal stop/resume handoff, and no
commits without Lead authorization. Executor and Reviewer remain alive
until Lead accepts the task and reclaims the pair.

Runtime packages are installed once with `pi-team setup`; project worktrees do
not download their own copies. All Pi roles reject ambient extensions, and
only Researcher loads `pi-web-access`.
