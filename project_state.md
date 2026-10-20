# Project state — persistent group implementation (2026-10-20)

The v2 implementation follows ADR/0009-persistent-group-workflow.md. It replaces the active v1 role and Blackboard/contract negotiation paths with persistent Coordinator/Executor/Validator groups, fixed worktrees, document handoff and one SQLite authority under the Git common directory.

## Implemented behavior

- One active task per group, stable sessions, focused task branches and runtime-injected task/generation identity pinned to the agent turn.
- One Executor plan and exactly one adversarial Validator plan review before implementation. Code Review reads source/diff/tests and can require multiple fixes.
- Process documents are grouped by module/task and retained in Git. Runtime content snapshots, local delivery commits and review references preserve version identity.
- Explicit success/rejection receipts, transactional handoff and idempotent submission. Open work survives read receipts, lost wakeups and process replacement. Interrupted task switching can be retried from its recorded Git transition.
- Lead communicates through Coordinator using durable send/inbox/wait. Final acceptance and integration remain Lead-owned; finalization preserves group sessions and worktree. Integration failure records progress for retry without re-merging.
- New inbox arrivals are steered at tool boundaries and checked atomically before submission. Frozen delivery documents and independent review-NN evidence remain separate; unfinished handoffs create durable deduplicated Coordinator alerts.
- current_state text is display only. No Blackboard activity tool or formal contract/debate/ACK extension is loaded.
- Runtime health faults pause automatic model retriggers until explicit recovery; compaction saves current-work context and preserves sessions on failure.
- Role tools/providers/skills have one launch configuration in .pi/roles.json. Native command execution explicitly uses PowerShell.

## Verification and deployment boundary

The active deterministic suite has 19 passing scenarios, including installed-Pi extension loading, actual PowerShell execution, Windows hidden launcher/session recovery, native CLI/MCP integration, cross-process concurrency, killed-writer rollback, version checks and integration retry. Existing v1 test files remain historical specifications; see tests/MIGRATION.md.

Real-provider smoke runs in an independent temporary Git repository, keeping experiments separate from canonical state. The first smoke attempt was stopped after discovering that a command-tool stage gate prevented read-only Git discovery; the gate was corrected and all roles restarted in a fresh fixture. The replacement run has causally completed one plan-review round, D1 rejection, D2 repair/pass, Coordinator delivery, same-ID Executor recovery and Lead acceptance/integration. The second task then completed its own plan/review/implementation/code-review/Coordinator-delivery sequence on the same group. After the original smoke driver exited, an independent final driver rechecked the second delivery against current runtime checks and recorded Lead acceptance/integration. The group is idle, both task histories are retained, and the smoke processes are stopped. Sanitized outcomes, process documents and raw event evidence are archived outside Git under the common-dir v2 verification store.

Implementation is on the isolated codex/group-runtime branch. The canonical develop checkout and global MCP registration have not been switched. Current inventory contains 11 legacy task records still marked pending; their actual process/outcome status must be assessed and explicitly completed or closed using the pre-cutover checkout. They are not silently accepted, cancelled or migrated. Existing user audit changes and .pi/legacy history are preserved.

Supported baseline: native Windows, Node 24.11+, Pi 0.84.2. The Node SQLite interface is available in the verified host runtime. Coordinator research uses installed pi-web-access when available; credentials remain managed by Pi outside the repository.
