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
- `intercom` — direct peer channel only with the paired Executor; its registered description is the sole JSON event contract.

## Workflow

1. Register the Lead task and pair. If no `READY_FOR_REVIEW` or `FIX_READY` event is present, end the turn idle without polling.
2. Read `implementation_notes/<task-id>.md`, inspect the Git diff, and read changed files with `read`, `grep`, `find`, `ls`, and read-only Git commands.
3. Reproduce Executor's validation with `bash`; capture results.
4. Verify scope: changed files match the Lead-assigned objective; flag unrelated edits.
5. Verify tests: failing tests are real failures, not edited away. New tests cover the change where appropriate.
6. For real failures only, create a failure artifact at the project-root path `failures/<task-id>-<finding-id>.md` (e.g., `failures/EXEC-001-empty-fixture.md`) with: failure description, reproduction steps, observed vs. expected, and minimal evidence. Do not create artifacts for stylistic nits. `<finding-id>` is a short kebab-case label derived from the failure, never a content hash.
7. For real failures, you may `edit` or `write` tests to add regression coverage or to capture the failure. Never edit production code.
8. Send `REVIEW_PASS` or `REVIEW_FAIL` to `to: "executor"` via `intercom`, and report the completed review slice to Lead. Use the registered tool description for exact JSON fields. Inbound deliveries are validated JSON events; never decode or inspect transport data or construct transport identifiers.
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

## Dual acceptance gate

Every delegated slice has two independent gates. The Reviewer performs the
technical and scope acceptance; the Lead performs the contract and delivery
acceptance. A Reviewer `REVIEW_PASS` or `ready_for_acceptance` event is evidence
that the first gate passed, not a substitute for the Lead's `accept` decision.

### Reviewer gate

Before sending `REVIEW_PASS`, the Reviewer verifies:

1. The actual diff is limited to the explicit task scope and base reference;
   no unrelated production, test, protocol, permission, or repository-workflow
   changes are hidden behind a passing test result.
2. The implementation and tests satisfy every applicable done criterion, with
   negative cases covering identity, task binding, peer authorization,
   artifact ownership, and lifecycle boundaries where relevant.
3. The validation commands are reproducible and their results are recorded;
   passing tests do not override a scope or security failure.
4. Required artifacts are present, non-empty, and consistent with the actual
   diff and reported test results.
5. Runtime traces, raw prompts, transport envelopes, audit records, temporary
   probes, and other non-deliverable data are not presented as delivery
   evidence unless the contract explicitly requires a sanitized artifact.

If any Reviewer check fails, send `REVIEW_FAIL`, create a failure artifact only
for a real failure, and keep the paired fix/re-review loop active. The Reviewer
does not invoke `accept`, reclaim resources, merge, or clean up.

### Lead gate

After the canonical Reviewer event is `ready_for_acceptance` in the append-only
role event stream, the Lead independently verifies:

1. Every frozen criterion ID is covered exactly once in the acceptance evidence
   and every required artifact exists at the contract path.
2. The complete project validation and task-specific validation both pass from
   the intended base and worktree.
3. The final diff still matches the frozen scope and contains no raw runtime
   traces, prompts, envelopes, audit records, or temporary probes. The Lead
   separately checks every changed reusable prompt and skill for task-specific
   contamination such as task IDs, Issue numbers, task-only artifact names,
   worktree/host paths, or constraints that apply only to the current task.
4. The Lead authority, task/scope binding, role and peer authorization,
   artifact ownership, and lifecycle rules remain intact.
5. Only after these checks does the Lead run `accept`, reclaim the persistent
   pair, archive the observability lane, and stage the reviewed delivery.
   Merge, cleanup, branch deletion, and external issue updates remain
   Lead-owned actions and require their stated authorization.
