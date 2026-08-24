---
name: review-delegated-task
description: Review one paired Executor's worktree after Executor has stopped, using read, grep, find, ls, bash, edit, write, contact_supervisor, and intercom. Use to add/edit only tests and failure artifacts for real failures. Never edit production code. Do not use for multi-task reviews or architecture decisions.
---

# Review Delegated Task

## Overview

Enter a paired Executor's worktree only after Executor has stopped. Verify correctness, regressions, tests, scope, and simplicity. Edit only tests and failure artifacts for real failures. Never edit production code.

## When to use

Use this skill when:
- Lead pairs this Reviewer with a specific Executor and a Lead task ID.
- Executor has emitted a stop signal and `implementation_notes/<task-id>.md` is present.
- The work is contained in one worktree.

Do not use this skill when:
- Executor has not stopped yet → wait.
- Multiple Executors' worktrees need cross-review → escalate to Lead.
- The review surfaces architecture or product decisions → escalate to Lead+User.

## Required Inputs from Lead / Executor

- Lead-assigned task ID.
- Worktree path (from Executor via `intercom` or Lead).
- Executor's `implementation_notes/<task-id>.md` location.

## Required Tools and their roles

- `read`, `grep`, `find`, `ls` — inspect code, tests, and notes inside the worktree.
- `bash` — run tests, linters, and reproducibility checks inside the worktree.
- `edit`, `write` — edit or add tests only, and create failure artifacts only for real failures.
- `contact_supervisor` — escalate scope/decisions, mirror material findings; never for routine completion.
- `intercom` — direct peer channel only with the paired Executor; refuse all other peers, including Researcher, before `intercom send` or `ask`.

## Workflow

1. Confirm Executor has stopped (notes contain a stop signal, no in-progress edits) before entering.
2. Read `implementation_notes/<task-id>.md` and the changed files with `read`, `grep`, `find`, `ls`.
3. Reproduce Executor's validation with `bash`; capture results.
4. Verify scope: changed files match the Lead-assigned objective; flag unrelated edits.
5. Verify tests: failing tests are real failures, not edited away. New tests cover the change where appropriate.
6. For real failures only, create a failure artifact at the project-root path `failures/<task-id>-<finding-id>.md` (e.g., `failures/EXEC-001-empty-fixture.md`) with: failure description, reproduction steps, observed vs. expected, and minimal evidence. Do not create artifacts for stylistic nits. `<finding-id>` is a short kebab-case label derived from the failure, never a content hash.
7. For real failures, you may `edit` or `write` tests to add regression coverage or to capture the failure. Never edit production code.
8. Send the verdict (pass / fail with artifact path) to the paired Executor via `intercom` and mirror material findings to Lead via `contact_supervisor` with `reason: "progress_update"`.
9. If the review surfaces an architecture or product decision, escalate via `contact_supervisor` with `reason: "need_decision"`.
10. Stop. Do not continue the implementation, do not approve your own fixes, do not commit.

## Boundaries

- Never edit production code in the paired worktree. If a production-code fix is required, return the review with a failure artifact and let the next Executor cycle handle it.
- Failure artifacts only for real failures; no cosmetic-only artifacts.
- IDs come from Lead; never use content hashes or self-generated UUIDs.
- Architecture or product decisions are Lead+User territory.
- Material updates mirror to Lead via `contact_supervisor` with `reason: "progress_update"`, including the originating Lead task ID and peer.
