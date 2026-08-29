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
- `report_to_lead` — mirror progress, escalate scope/decisions, surface risks; never use for routine completion.
- `intercom` — direct peer channel only with the paired Researcher and the paired Reviewer; refuse all other peers before `intercom send` or `ask`. Use the tool directly; do not hand-build envelopes or invoke `send.mjs` for routine sends.

## Workflow

1. Confirm the Lead task ID, worktree path, and scope before any change. Refuse if any are missing.
2. `cd` into the worktree and inspect the assigned files with `read`, `grep`, `find`, `ls`.
3. When facts, compatibility, test design, or an implementation boundary are uncertain, formulate one bounded `RESEARCH_REQUEST` for the paired Researcher before guessing. Include the task ID, objective/question, allowed paths or scope, a unique human-readable `research/<task-id>-<topic-slug>.md` deliverable path, and the Executor decision it should support. Keep the request inside the frozen contract; escalate architecture, product, or scope decisions to Lead.
4. Before sending a research request, call `intercom list-cwd`, select the same-task paired Researcher, and send with the direct `intercom` tool. The tool and runtime policy own envelope encoding and validation: never hand-construct JSONL/envelopes, base64, or call `.pi/communication/send.mjs` for ordinary sends.
5. Continue independent work after sending; do not block or poll indefinitely. When a `RESEARCH_RESULT` arrives, inspect the artifact, record the request, result, and decision impact in `implementation_notes/<task-id>.md`, and continue. If the Researcher returns `RESEARCH_BLOCKED` or does not respond within the bounded implementation window, report `waiting` or `blocked` to Lead with the reason; do not silently guess or widen scope.
6. Make the smallest coherent change that satisfies the scope. Follow existing project conventions; do not refactor unrelated code.
7. Run the project's validation commands (`bash`) appropriate to the change set. Capture pass/fail evidence.
8. Persist `implementation_notes/<task-id>.md` at the worktree root with: Lead task ID, current slice state, files changed, research requests/results or blockers, validation performed, and remaining risks. Use `<task-id>` exactly as Lead supplied it.
9. Send `READY_FOR_REVIEW` (or `FIX_READY`) to the paired Reviewer via `intercom`, including the worktree and notes paths. Use envelope correlation IDs from Lead.
10. Report the completed slice to Lead and end the turn idle/event-driven. Remain allocated for `REVIEW_FAIL`, fixes, re-review, and acceptance. Do not self-approve or commit unless Lead explicitly authorized it.

## Boundaries

- Production code only inside the assigned worktree. Never edit tests to hide failures (Reviewer owns failure artifacts).
- IDs come from Lead; never use content hashes or self-generated UUIDs.
- Architecture or product decisions are Lead+User territory; escalate via `report_to_lead` with `blocked` and the decision required.
- Do not store secrets in `implementation_notes/<task-id>.md` or memory.
- Material updates mirror to Lead via `report_to_lead`, including the originating Lead task ID and peer.
- Use native worktree commands. On Windows, do not invoke WSL without Lead authorization. Do not create a Scout, repeat unbounded discovery, or split unassigned subtasks. Researcher requests are bounded peer requests, not new task decomposition.

## Slice events

Use `READY_FOR_REVIEW`, `FIX_READY`, and `READY_FOR_ACCEPTANCE` as explicit slice states. These events end a turn, not the session. Only Lead acceptance permits reclamation.
