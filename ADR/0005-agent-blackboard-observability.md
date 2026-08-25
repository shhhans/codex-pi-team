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

The repo-local `agent-blackboard` plugin exposes Lead-only MCP tools for task
management, snapshot, cursor-based watch, and rendering. Its task-lane UI
requests PiP when supported and falls back inline; closing the UI does not
disable the Lead watcher. Archived tasks remain queryable with
`include_archived=true` and are hidden from the default snapshot.

Executor and Reviewer remain persistent through review/fix and re-review until
Lead acceptance and reclamation. The Blackboard does not introduce a stop
handoff or infer activity from file operations or model thoughts.
