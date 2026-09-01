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
- `blackboard_update` — publish task status and request a Lead wakeup with `blocked`, `changes_requested`, or `ready_for_review` when Lead attention is required.
- `intercom` — direct peer channel only with the paired Researcher and the paired Reviewer; refuse all other peers before `intercom send` or `ask`. Use the tool directly; do not hand-build envelopes or invoke `send.mjs` for routine sends.

## Workflow

1. Confirm the Lead task ID, worktree path, and scope before any change. Refuse if any are missing.
2. `cd` into the worktree and inspect the assigned files with `read`, `grep`, `find`, `ls`.
3. When facts, compatibility, test design, or an implementation boundary are uncertain, formulate one bounded JSON `RESEARCH_REQUEST` event for the paired Researcher before guessing. Runtime, not the role, constructs the standard `agent-team/v1` envelope. The required event schema (validated at the runtime gate by `policy.mjs` `validateResearchBody` and `authorizeResearchDelegation`) is:

   - `type` (literal `"RESEARCH_REQUEST"`),
   - `task_id` (must equal `PI_TEAM_TASK_ID`),
   - `delegation_id` (must equal the contract's Researcher delegation),
   - `request_id` (the Lead-supplied request identifier; runtime derives the envelope `correlation_id` from it),
   - `decision_supported` (one-sentence description of the implementation decision this research unblocks),
   - `objective` (one bounded question, ≤240 chars; never an architectural, product, or scope-shaping question),
   - `allowed_paths` (non-empty subset of the contract's `in_scope`; must not intersect `out_of_scope`),
   - `artifact_path` (must match `^research/<task-id>-<kebab-slug>\.md$`; slug is unique, no path-traversal, no content hash, no UUID),
   - `required_capabilities` (non-empty subset of `RESEARCHER_CAPABILITIES`; never request `bash` / `edit` / Deep Research tools),
   - `frozen_contract_version` (positive integer from the current contract snapshot),
   - optional `deadline_hint` (ISO 8601 string) and `context_refs` (string[] inside `allowed_paths`).

   A request that violates the schema is refused at `runtime-policy.mjs` `onToolCall` before the envelope reaches the transport; the audit row records `direction: "outbound", outcome: "refused", reason: "research-schema-invalid:..."`. Keep the request inside the frozen contract; escalate architecture, product, or scope decisions with `blackboard_update` state `blocked` and the decision needed in `blocker`.
4. Send the paired Researcher a JSON event through `intercom` with `to: "researcher"`. Do not call `list-cwd`, provide a session/launch ID, construct JSONL/envelopes or base64, or call `.pi/communication/send.mjs`; runtime resolves the current peer and owns correlation, encoding, and validation.
5. Continue independent work after sending; do not block or poll indefinitely. When a `RESEARCH_RESULT` arrives, inspect the artifact, record the request, result, and decision impact in `implementation_notes/<task-id>.md`, and continue. The `RESEARCH_RESULT` body schema (validated at the inbound gate by `policy.mjs` `validateResearchBody`) is:

   - `type` (literal `"RESEARCH_RESULT"`),
   - `task_id`, `delegation_id`, `request_id` (mirror the original request; `request_id` must equal the request's `request_id` and the envelope `correlation_id`),
   - `artifact_path` (must equal the request's `artifact_path`; the file must exist and be non-empty),
   - `headline` (one-sentence answer, ≤240 chars),
   - `findings` (non-empty array; each entry has `claim`, `sources[]`, and `confidence` ∈ `high|medium|low`),
   - optional `gaps` (string[]),
   - `confidence` (overall ∈ `high|medium|low`),
   - `decision_impact` (one-sentence description of how the Executor should use the result).

   A `RESEARCH_BLOCKED` body uses `reason_code` ∈ `out_of_scope | architectural | under_specified | capability_blocked | in_flight_busy | scope_change_invalidated | deadline_unmet | duplicate | no_response_within_window`, a `detail` string ≤1024 chars, and (when `reason_code` is `architectural | out_of_scope | under_specified`) a required `next_decision_needed` ≤240 chars. If the Researcher returns `RESEARCH_BLOCKED` or does not respond within the bounded implementation window, report `waiting` or `blocked` to Lead with the reason; do not silently guess or widen scope.
6. Make the smallest coherent change that satisfies the scope. Follow existing project conventions; do not refactor unrelated code.
7. Run the project's validation commands (`bash`) appropriate to the change set. Capture pass/fail evidence.
8. Persist `implementation_notes/<task-id>.md` at the worktree root with: Lead task ID, current slice state, files changed, research requests/results or blockers, validation performed, and remaining risks. Use `<task-id>` exactly as Lead supplied it.
9. Send a JSON `READY_FOR_REVIEW` (or `FIX_READY`) event to `to: "reviewer"`, including `task_id`, worktree, and notes path. Runtime supplies the envelope correlation ID.
10. Report the completed slice to Lead and end the turn idle/event-driven. Remain allocated for `REVIEW_FAIL`, fixes, re-review, and acceptance. Do not self-approve or commit unless Lead explicitly authorized it.
## Boundaries

- Production code only inside the assigned worktree. Never edit tests to hide failures (Reviewer owns failure artifacts).
- IDs come from Lead; never use content hashes or self-generated UUIDs.
- Architecture or product decisions are Lead+User territory; escalate through `blackboard_update` with state `blocked` and the decision required.
- Do not store secrets in `implementation_notes/<task-id>.md` or memory.
- Material updates are published through `blackboard_update`, including the originating Lead task ID and peer.
- Use native worktree commands. On Windows, do not invoke WSL without Lead authorization. Do not create a Scout, repeat unbounded discovery, or split unassigned subtasks. Researcher requests are bounded peer requests, not new task decomposition.

## Slice events

Use `READY_FOR_REVIEW`, `FIX_READY`, and `READY_FOR_ACCEPTANCE` as explicit slice states. These events end a turn, not the session. Only Lead acceptance permits reclamation.
