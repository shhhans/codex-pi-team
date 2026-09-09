# ADR 0005 — Agent Blackboard observability plane

Status: Accepted
Date: 2026-08-24

The project provides a local Agent Blackboard for Lead task observability. Its
state root is `<git-common-dir>/harness-blackboard/v1/`, so the main worktree
and every task worktree see the same task lanes without writing files into a
worktree or changing Git status.

The Lead exclusively creates and updates task metadata (`task_id`, `name`,
`description`, and lifecycle status). Task IDs are immutable. Name and
description changes append revision records. Agents cannot create tasks or
change the task definition.

Agents append their own activity events through `blackboard_update`. Runtime
identity (`role`, `agent_id`, `worktree`), sequence, and observation time come
from the launcher and blackboard runtime; the tool accepts only the task ID,
state, activity, blocker, and next action. Events are append-only per task and
role, use human-readable task IDs, and do not use application-layer hashes.

The Blackboard is an observation and reminder plane, not an authorization
system, completion proof, or communication bus. Scope correction and decisions
continue through the existing Lead `report_to_lead`, supervisor, and intercom
paths. A watcher timeout means only that no new Agent event arrived.

An active task may also have one explicit Lead thread binding. Critical Agent
states (`blocked`, `changes_requested`, `ready_for_review`,
`ready_for_acceptance`, and `completed`) create persistent structured wakeups
identified by task, role, and event sequence. A Codex host adapter may deliver
these as concise follow-up prompts and acknowledge them. Wakeups never grant
authorization, prove completion, or replace Lead inspection and acceptance.

The repo-local `agent-blackboard` plugin exposes Lead-only MCP tools for task
management, snapshot, cursor-based watch, and rendering. `blackboard_snapshot`
also accepts a caller-owned cursor and returns the current active task snapshot
plus only newly observed critical changes. It does not persist the cursor;
retrying with the previous cursor therefore preserves at-least-once
observation. Periodic Codex heartbeat checks use this snapshot path rather than
`blackboard_watch`, and do not require thread binding or a wakeup transport. Its
task-lane UI requests PiP when supported and falls back inline; closing the UI
does not disable the Lead watcher. Archived tasks remain queryable with
`include_archived=true` and are hidden from the default snapshot.

Formal task publication also has a canonical non-MCP adapter:
`pi-team.cmd publish <contract-path>` validates the Lead-owned contract and
calls the same packaged Blackboard core. This prevents MCP discovery or UI
readiness from blocking delegation without creating a second state format or
permitting direct shared-state edits. MCP remains responsible for interactive
watching, reminders, and the task-lane UI. The local stdio server has no
authentication flow; an “authentication unsupported” label is expected and is
separate from connection readiness.

Executor and Reviewer remain persistent through review/fix and re-review until
Lead acceptance and reclamation. The Blackboard does not introduce a stop
handoff or infer activity from file operations or model thoughts. `inspect`
and `finalize` may read the Blackboard as an observation source, but an
unconverged agent projection is returned as a warning and does not block a
Lead-authorized finalization.
