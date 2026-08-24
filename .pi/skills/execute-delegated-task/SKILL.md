---
name: execute-delegated-task
description: Implement one delegated task through a persistent paired review/fix loop inside an isolated worktree. Use when Lead assigns the task contract, worktree, and Reviewer. Do not use for architecture decisions, unassigned decomposition, or production deploys.
---

# Execute Delegated Task

## Overview

Implement the smallest coherent change for a single delegated task inside the assigned isolated worktree, validate it, persist `implementation_notes/<task-id>.md`, and remain available for the paired review/fix loop.

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
- `contact_supervisor` — mirror progress, escalate scope/decisions, surface risks; never use for routine completion.
- `intercom` — direct peer channel only with the paired Researcher and the paired Reviewer; refuse all other peers before `intercom send` or `ask`.

## Workflow

1. Confirm the Lead task ID, worktree path, and scope before any change. Refuse if any are missing.
2. `cd` into the worktree and inspect the assigned files with `read`, `grep`, `find`, `ls`.
3. Make the smallest coherent change that satisfies the scope. Follow existing project conventions; do not refactor unrelated code.
4. Run the project's validation commands (`bash`) appropriate to the change set. Capture pass/fail evidence.
5. Persist `implementation_notes/<task-id>.md` at the worktree root with: Lead task ID, current slice state, files changed, validation performed, and remaining risks. Use `<task-id>` exactly as Lead supplied it.
6. Send `READY_FOR_REVIEW` (or `FIX_READY`) to the paired Reviewer via `intercom`, including the worktree and notes paths. Use envelope correlation IDs from Lead.
7. Report the completed slice to Lead and end the turn idle/event-driven. Remain allocated for `REVIEW_FAIL`, fixes, re-review, and acceptance. Do not self-approve or commit unless Lead explicitly authorized it.

## Boundaries

- Production code only inside the assigned worktree. Never edit tests to hide failures (Reviewer owns failure artifacts).
- IDs come from Lead; never use content hashes or self-generated UUIDs.
- Architecture or product decisions are Lead+User territory; escalate via `contact_supervisor` with `reason: "need_decision"`.
- Do not store secrets in `implementation_notes/<task-id>.md` or memory.
- Material updates mirror to Lead via `contact_supervisor` with `reason: "progress_update"`, including the originating Lead task ID and peer.
- Use native worktree commands. On Windows, do not invoke WSL without Lead authorization. Do not create a Scout, repeat unbounded discovery, or split unassigned subtasks.

## Slice events

Use `READY_FOR_REVIEW`, `FIX_READY`, and `READY_FOR_ACCEPTANCE` as explicit slice states. These events end a turn, not the session. Only Lead acceptance permits reclamation.
