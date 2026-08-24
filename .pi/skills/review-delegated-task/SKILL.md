---
name: review-delegated-task
description: Persistently review one paired Executor's worktree across review/fix cycles. Use read-only Git, local inspection, and validation; edit only tests and real-failure artifacts. Never edit production code or normative documentation.
---

# Review Delegated Task

## Overview

Register one Lead-assigned Executor pair, wait idle for review events, and verify correctness, regressions, tests, scope, and simplicity across the complete review/fix loop. Edit only tests and failure artifacts for real failures. Never edit production code or normative documentation.

## When to use

Use this skill when:
- Lead pairs this Reviewer with a specific Executor and a Lead task ID.
- Executor has emitted `READY_FOR_REVIEW` or `FIX_READY` and `implementation_notes/<task-id>.md` is present.
- The work is contained in one worktree.

Do not use this skill when:
- No review event has arrived yet → end the turn idle and wait for the injected event.
- Multiple Executors' worktrees need cross-review → escalate to Lead.
- The review surfaces architecture or product decisions → escalate to Lead+User.

## Required Inputs from Lead / Executor

- Lead-assigned task ID.
- Worktree path (from Executor via `intercom` or Lead).
- Executor's `implementation_notes/<task-id>.md` location.
- Lead-supplied objective, scope, done criteria, and paired Executor identity.

## Required Tools and their roles

- `read`, `grep`, `find`, `ls` — inspect code, tests, and notes inside the worktree.
- `bash` — run tests, linters, reproducibility checks, and read-only Git inspection inside the worktree.
- `edit`, `write` — edit or add tests only, and create failure artifacts only for real failures.
- `contact_supervisor` — escalate scope/decisions, mirror material findings; never for routine completion.
- `intercom` — direct peer channel only with the paired Executor; refuse all other peers, including Researcher, before `intercom send` or `ask`.

## Workflow

1. Register the Lead task and pair. If no `READY_FOR_REVIEW` or `FIX_READY` event is present, end the turn idle without polling.
2. Read `implementation_notes/<task-id>.md`, inspect the Git diff, and read changed files with `read`, `grep`, `find`, `ls`, and read-only Git commands.
3. Reproduce Executor's validation with `bash`; capture results.
4. Verify scope: changed files match the Lead-assigned objective; flag unrelated edits.
5. Verify tests: failing tests are real failures, not edited away. New tests cover the change where appropriate.
6. For real failures only, create a failure artifact at the project-root path `failures/<task-id>-<finding-id>.md` (e.g., `failures/EXEC-001-empty-fixture.md`) with: failure description, reproduction steps, observed vs. expected, and minimal evidence. Do not create artifacts for stylistic nits. `<finding-id>` is a short kebab-case label derived from the failure, never a content hash.
7. For real failures, you may `edit` or `write` tests to add regression coverage or to capture the failure. Never edit production code.
8. Send `REVIEW_PASS` or `REVIEW_FAIL` (with artifact paths and evidence) to the paired Executor via `intercom` and report the completed review slice to Lead.
9. If the review surfaces an architecture or product decision, escalate via `contact_supervisor` with `reason: "need_decision"`.
10. End the turn idle/event-driven. On failure, wait for `FIX_READY` and re-review in the same session. On pass, remain idle until Lead accepts and reclaims the pair. Do not continue implementation, approve your own fixes, or commit.

## Boundaries

- Never edit production code in the paired worktree. If a production-code fix is required, return the review with a failure artifact and let the next Executor cycle handle it.
- Failure artifacts only for real failures; no cosmetic-only artifacts.
- IDs come from Lead; never use content hashes or self-generated UUIDs.
- Architecture or product decisions are Lead+User territory.
- Material updates mirror to Lead via `contact_supervisor` with `reason: "progress_update"`, including the originating Lead task ID and peer.
- Read-only Git operations (`status`, `diff`, `log`, `show`, `blame`, and equivalent) are allowed. Worktree-changing Git operations require explicit Lead authorization.
- Use native worktree commands. On Windows, do not invoke WSL without Lead authorization. Do not create a Scout or unassigned subtasks.
