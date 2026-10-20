# Pi Team architecture

ADR/0009-persistent-group-workflow.md is normative. A persistent module group contains Coordinator, Executor and Validator, one fixed worktree and at most one active task. Coordinator handles outside contacts and task decisions within Lead scope; Executor implements; Validator performs one adversarial plan review and source/diff/test Review. Lead alone accepts and integrates.

The SQLite group runtime is the only task/work/message authority. Group process identity is stable; active task identity and generation change at task boundaries. Markdown process evidence enters Git; runtime queues, session identity, document snapshots and recovery records stay in the common directory. Each local delivery commit gets a D-number. Review and acceptance refer to that exact code version.

Pi loads one explicitly selected group extension and private role skill. .pi/roles.json supplies the single tool/provider/model configuration. The extension handles durable inbox dispatch, explicit document handoff, compaction and display-only current_state text. Intercom is not required for correctness; this implementation uses the shared durable inbox directly rather than loading native intercom. There are no Blackboard/contract-ACK tools in active role sessions.

The Windows wrapper invokes a Node lifecycle service. Lead MCP exposes send/inbox/wait/inspect/accept/finalize. Group finalization integrates accepted changes but preserves the fixed group worktree and sessions. Old v1 files remain historical and are not loaded by v2 entrypoints.

RoleTools binds identity to each agent turn and emits explicit transaction receipts. Inbox presentation and handling completion have separate timestamps; steering delivers new messages at safe tool boundaries, and submission checks the inbox atomically. Frozen delivery files are separate from review-NN evidence. An unfinished handoff emits a deduplicated Coordinator alert and can be resolved through existing work rather than a parallel state machine.
