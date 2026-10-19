# ADR 0009 — Persistent groups and document handoff

Status: Accepted by user design decisions, implementation under verification.
Date: 2026-10-19
Supersedes active workflow and interface rules in ADR 0002, 0003, 0005, 0007 and 0008. Their historical evidence remains intact. Explicit user development/recovery instructions remain authoritative.

## Decision

A group persistently owns one module, fixed worktree and Coordinator/Executor/Validator sessions. Tasks are serial inside a group and parallel across groups. Lead owns scope changes, external commitments, acceptance and integration. Coordinator owns module delivery and communication, including direct Coordinator-to-Coordinator information exchange. Executor and Validator communicate directly during normal fixes.

Each task writes process Markdown below groups/<group>/tasks/<task>/. Coordinator submits task.md; Executor submits plan.md; Validator submits one plan-review.md; Executor reads it and implements, recording adoption/rejection reasons in implementation.md. Plan review is adversarial advice, not a pass/ACK gate. A second plan-review round is prohibited. Genuine blockers go to Coordinator; material objective changes become a new Lead-owned task.

Executor creates clean local task-branch commits and submits deliveries D1, D2, etc. Validator reads source/diff/tests and submits code-review-NN.md bound to the delivery commit, separating must-fix defects from suggestions. Outcomes are pass, changes_requested and blocked. Fixes produce a fresh delivery and review. Blocked checks are resolved by Coordinator through decision-N.md and a new delivery, retaining the blocked report. Coordinator submits delivery.md only after passing Review. Only Lead accepts and integrates.

Runtime authority is SQLite below <git-common-dir>/pi-team-runtime/v2. Document content snapshots, work completion and successor creation are one transaction. Documents are written first; explicit submission is the handoff. Model activities, process availability and notification receipts cannot authorize workflow transitions. Reading a wakeup is distinct from completing work. Recovery rediscovers open work without model polling. IDs in artifacts are human-readable; Git object IDs are internal code-version references.

The group extension exposes team_read, team_send and team_submit. It registers process/session identity and dynamically reads current task/generation. Every mutation is checked against the current assignment. The message prefix [current_state: "description"] is best-effort display only. Blackboard state tools, formal debate and full-body ACKs are no longer active. The Lead uses a durable inbox and bounded wait; no autonomous desktop-chat wakeup is promised.

Three sessions remain alive when a task completes. Only idle groups can change task branches. Finalization keeps the group worktree, returns it to its idle branch and preserves sessions. Incomplete branches/evidence are retained. No live migration of v1 tasks is performed; cutover requires explicit completion or closure first.

## Enforcement boundary

Tool wrappers limit obvious file mutations and stage-dependent Executor commands. This is not a shell sandbox: Validator shell use can inspect code and run tests, and its prohibition on production edits remains a role rule. Git/evidence checks reject drift before review submission and Lead acceptance. Transport delivery is not proof of causal message use; live validation must inspect resulting documents and revisions.
