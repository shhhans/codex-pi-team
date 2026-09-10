---
name: execute-delegated-task
description: Implement one delegated task through a persistent paired review/fix loop inside an isolated worktree, while proactively requesting bounded research from the paired Researcher when implementation uncertainty arises. Use when Lead assigns the task contract, worktree, and Reviewer. Do not use for architecture decisions, unassigned decomposition, or production deploys.
---

# Execute Delegated Task

## Overview

Implement the smallest coherent change for a single delegated task inside the assigned isolated worktree, request targeted evidence from the paired Researcher when needed, validate it, persist `implementation_notes/<task-id>.md`, and remain available for the paired review/fix loop.

## When to use

Use this skill when:
- Lead has assigned a Lead task ID, an isolated worktree path, and a single scoped change.
- The work is bounded, code-shaped, and reversible inside the worktree.
- Lead has assigned the paired Reviewer; both roles persist until acceptance.

Do not use this skill when:
- The task spans multiple worktrees or requires production deploy → escalate to Lead.
- The task is architectural or product-shaping → escalate to Lead+User.
- The worktree path, task ID, or scope is missing → refuse and ask Lead.

## Required Inputs from Lead

- Lead-assigned task ID (never a content hash).
- Isolated worktree path.
- Single, scoped objective with explicit done criteria.
- Constraints (style, tests, files in/out of scope).
- Paired Reviewer identity.

## Required Tools and their roles

- `read`, `grep`, `find`, `ls` — local inspection within the worktree only.
- `bash` — run tests, formatters, and verification commands inside the worktree.
- `edit`, `write` — change code and persist artifacts only inside the worktree.
- `blackboard_update` — publish task status and request a Lead wakeup with `blocked`, `changes_requested`, or `ready_for_review` when Lead attention is required. The runtime enforces a Blackboard protocol: `activity` is the observed fact, `blocker` is required whenever the state is `blocked` or `changes_requested`, `next` is required for every non-terminal state, and identical repeats of the prior event are refused. The lifecycle gate fires on the first substantive tool call and again after every 20 substantive tool calls without an update; it fails open after 2 consecutive blocks.
- `pi_team_intercom` — direct peer channel only with the paired Researcher and Reviewer. Its registered description is the sole JSON event contract; never hand-build transport data.

### Command tool contract

Do not infer command syntax from the builtin tool name `bash`. Before invoking
it, follow the launch-time `Tool runtime metadata` fields
`command_interpreter` and `command_syntax_examples`; the launcher detects them
from the active runtime. Prefer `read`, `grep`, `find`, and `ls` for
inspection; use `bash` only when a command is actually needed.

## Workflow

1. Confirm the Lead task ID, worktree path, and scope before any change. Refuse if any are missing.
2. `cd` into the worktree and inspect the assigned files with `read`, `grep`, `find`, `ls`.
3. When facts, compatibility, test design, or an implementation boundary are uncertain, send one bounded `RESEARCH_REQUEST` to the paired Researcher before guessing. Read the exact JSON contract from `pi_team_intercom` at call time.
4. Continue independent work after sending; do not block or poll indefinitely. When a `RESEARCH_RESULT` or `RESEARCH_BLOCKED` arrives, inspect it and record its impact in `implementation_notes/<task-id>.md`.
5. Make the smallest coherent change that satisfies the scope. Follow existing project conventions; do not refactor unrelated code.
6. Run the project's validation commands (`bash`) appropriate to the change set. Capture pass/fail evidence.
7. Persist `implementation_notes/<task-id>.md` at the worktree root with: Lead task ID, current slice state, files changed, research requests/results or blockers, validation performed, and remaining risks. Use `<task-id>` exactly as Lead supplied it.
8. Send `READY_FOR_REVIEW` (or `FIX_READY`) to `to: "reviewer"`; obtain the exact event fields from the `pi_team_intercom` tool description.
9. Report the completed slice to Lead and end the turn idle/event-driven. Remain allocated for `REVIEW_FAIL`, fixes, re-review, and acceptance. Do not self-approve or commit unless Lead explicitly authorized it.

### Lead acceptance rejection

`REVIEW_FAIL` and a Lead acceptance rejection are different authorities, but
they reopen the same implementation/fix loop. When Lead sends an explicit
`LEAD_REQUEST_CHANGES` instruction through the authorized Intercom path, treat
it as an authoritative Lead follow-up: leave the idle state, apply the listed
changes, validate them, and report `FIX_READY` for Reviewer re-review. Do not
wait for another `REVIEW_FAIL`, and do not interpret arbitrary Intercom text as
this event. The message must identify the same `task_id`, the rejected done
criterion(s) or evidence, the required correction, and the expected next
artifact. Keep the source distinction in status and notes: `REVIEW_FAIL` is a
Reviewer gate failure; `LEAD_REQUEST_CHANGES` is a Lead delivery-acceptance
failure.
## Boundaries

- Production code only inside the assigned worktree. Never edit tests to hide failures (Reviewer owns failure artifacts).
- IDs come from Lead; never use content hashes or self-generated UUIDs.
- Architecture or product decisions are Lead+User territory; escalate through `blackboard_update` with state `blocked` and the decision required.
- Do not store secrets in `implementation_notes/<task-id>.md` or memory.
- Material updates are published through `blackboard_update`, including the originating Lead task ID and peer.
- Use native worktree commands. On Windows, do not invoke WSL without Lead authorization. Do not create a Scout, repeat unbounded discovery, or split unassigned subtasks. Researcher requests are bounded peer requests, not new task decomposition.

## Slice events

Use `READY_FOR_REVIEW`, `FIX_READY`, and `READY_FOR_ACCEPTANCE` as explicit slice states. These events end a turn, not the session. Only Lead acceptance permits reclamation.
