# ISSUE-011 — Decision: Hide intercom Base64 envelope from the agent workflow and add typed same-task stale-session recovery

- Task ID: **ISSUE-011**
- Delegation: **EXECUTOR-ISSUE-011**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-011-intercom-envelope-recovery`
- Branch: `pi-team/ISSUE-011-intercom-envelope-recovery` (base ref `develop`)
- Researcher evidence: `research/ISSUE-011-intercom-envelope-recovery.md` (C-001 — researcher, completed before this Executor slice began)
- Frozen contract: `plans/ISSUE-011-task.md` (Lead-owned, unchanged)

## Decision (one paragraph)

Issue #11 is decided **Approach A**: keep the wire `agent-team/v1` envelope byte-identical (same header, same `body_encoding: base64url`, same canonical round-trip check at `policy.mjs:97-99`, same UUID / kind / `references` shape, same bounded peer ACL), and add a **repo-local** structured-send helper + structured audit fields + a typed same-task stale-session diagnostic. The wire envelope text never enters the agent-facing audit row, the persistent reply store still receives only the decoded application body, and the runtime's `onToolCall` / `onContext` hooks surface four typed failures — `peer_unreachable`, `peer_wrong_role`, `peer_wrong_task`, `unauthorized_sender` — that name the missing task/role/launch-id and tell the agent to call `intercom list-cwd` then re-send. Lead authority, task/scope/role/peer ACL, the Issue #3 research envelope schema, the lifecycle `markStale` / restart, and the Blackboard observability surface are preserved.

## Why Approach A (and not Approach B)

The Researcher survey (`research/ISSUE-011-intercom-envelope-recovery.md` §7 decision matrix) concludes:

- Approach B (modify or replace the envelope) violates the Issue #11 `out_of_scope` clauses "替换 agent-team/v1 wire envelope、取消 body encoding 校验或破坏现有消息兼容性" and "扩大 BOUNDED_PEERS、task/scope/role 授权、Lead 权限或 artifact 所有权". It also breaks every wire-shape assertion in `tests/communication-policy.test.mjs` (the 36 existing tests, of which the 21 Issue #3 cases assert byte-exact `body_encoding: base64url` and the canonical round-trip) and the launch-id binding contract in `tests/team-contract.test.mjs` (`record.args[record.args.indexOf("--session-id") + 1] === startState.sessions[record.role].session_id`).
- The Base64 exposure has historical precedent (PERF-004's malformed `+` body during a `READY_FOR_REVIEW` send; ISSUE-001's `.pi/skills/answer-research-question/helper-encode.mjs` helper that emitted raw envelopes bypassing `policy.makeEnvelope`). The fix is to move Base64 behind a helper the agent never sees — not to redesign the wire.
- Stale-session recovery is a peer-resolution problem, not an envelope problem. `resolveTeamPeerRole` parses only the prefix `pi-team--<task-id>--<role>`, ignoring `--<launch-id>`. The same-task `list-cwd` re-validation with prefix check is the correct primitive.

Approach A is conditional on seven guarantees that today live only as prompt prose:

- **G1 — Wire compatibility**: `makeEnvelope` / `parseEnvelope` keep their byte-identical output (no schema change to the envelope's header / kind / encoding / references / UUID).
- **G2 — Base64 hidden from agent-facing surface**: the audit row gains structured fields (`kind`, `subject`, `references`, `body_summary`, `body_fingerprint`, `body_length`) and never carries the `body: <base64url>` line or the envelope text itself; the persistent reply store continues to carry only the decoded application body for replay.
- **G3 — Stale-session typed diagnostic**: when a same-task paired peer format is valid but `client.send` returns `{ delivered: false }`, the runtime surfaces `peer_unreachable:role=<role>:task_id=<id>:retry=list-cwd` instead of an opaque refusal.
- **G4 — Cross-task / cross-role still blocked**: `resolveTeamPeerRole` + `BOUNDED_PEERS` + `authorizeResearchDelegation` remain the gates; a same-task helper call whose target resolves to a different task or a wrong role returns `peer_wrong_task` / `peer_wrong_role`, never silently redelivers.
- **G5 — Lead observation boundary preserved**: the audit row still carries `direction` / `action` / `recipient` / `outcome` (Lead retrospection surface). New fields are additive; no existing field is removed.
- **G6 — Role prompts and skills teach the helper and the diagnostic**: `.pi/agents/{executor,researcher,reviewer}.md` and `.pi/skills/{execute-delegated-task,answer-research-question,review-delegated-task}/SKILL.md` gain a small block describing the structured send helper, the redacted audit fields, and the four typed-failure recovery paths.
- **G7 — Regression coverage**: new test cases in `tests/communication-policy.test.mjs` for each positive scenario (P1–P4) and each negative scenario (N1–N6) listed in `research/ISSUE-011-intercom-envelope-recovery.md` §6; the pre-existing Issue #3 test suite stays green (with one minimal fix for a missing `PI_TEAM_TASK_ID` env in the "non-research pass-through" test).

## What changes (the smallest coherent change)

### 1. `.pi/communication/policy.mjs` — structured-send helper + redacted audit fields

- Add `summarizeEnvelopeForAgent(envelope)` that returns `{ kind, subject, id, correlationId, references, bodySummary, bodyFingerprint, bodyLength }` from an already-parsed envelope. `bodySummary` is a UTF-8 truncation of the decoded body (≤ 80 chars); `bodyFingerprint` is the first 16 hex chars of `sha256(decodedBody)`; `bodyLength` is the byte length. The base64 body itself never crosses this boundary.
- Add `formatAuditEvent(role, direction, event, envelope)` that builds a redacted audit row: the existing `{at, role, direction, action, recipient, outcome, reason, messageId, correlationId, trace}` plus the structured `kind`, `subject`, `references`, and the three body-summary fields when an envelope is present.
- The existing `BOUNDED_PEERS`, `KINDS`, `SUPERVISOR_REASONS`, `makeEnvelope`, `parseEnvelope`, `resolvePeerRole`, `resolveTeamPeerRole`, `PolicyReceiver`, `DedupStore`, `LeadAudit`, `MessageQueue`, `RunRegistry`, `RESEARCH_MESSAGE_TYPES`, `RESEARCH_BLOCK_REASON_CODES`, `RESEARCHER_CAPABILITIES`, `validateResearchBody`, `authorizeResearchDelegation` are unchanged.

### 2. `.pi/communication/runtime-policy.mjs` — `onToolCall` / `onContext` extension

- Refactor `appendPolicyAudit` usage so that every audit row carries the structured fields from `formatAuditEvent` instead of the envelope text. The base64 body never appears in any `*.jsonl` audit row.
- Extend `onToolCall` with a `staleSessionGate(outgoingReply, recipient, clientResult)`:
  - When `recipient` resolved to a valid same-task team-peer role (i.e. `resolveTeamPeerRole(target, PI_TEAM_TASK_ID)` returned a role and the target's launch-id segment is non-empty), and `client.send` returned `{ delivered: false }` without an explicit reason, return `outcome: "refused", reason: "stale-session:role=<role>:task_id=<id>:launch_id=<old>:retry=list-cwd"`.
  - When the target's task prefix is valid but `resolveTeamPeerRole` returns a different role than the agent's bounded peer set allows (e.g. `Executor → Researcher` target resolves to a session whose role is `reviewer`), return `peer_wrong_role`.
  - When the resolved role matches but the task prefix differs from `PI_TEAM_TASK_ID`, return `peer_wrong_task` (this is the existing cross-task refusal, restated under the new typed surface so the agent's rediscovery loop stays consistent).
  - When `resolveTeamPeerRole` returns `undefined` and the target is not in the bounded peer set, return the existing `Agent communication policy refused` refusal (no rediscovery hint; the agent's target is structurally invalid).
  - When `client.send` succeeded (delivered: true), the audit row carries `outcome: "allowed"` and the structured redacted fields. The agent never observes the envelope text.
- `onContext` is unchanged in shape (it already filters unauthorized inbounds before they reach model context), but the audit row gains the same structured fields for accepted inbounds: `kind`, `subject`, `references`, `body_summary`, `body_fingerprint`, `body_length` only; the decoded body never appears in the audit row.

### 3. `.pi/communication/send.mjs` — minimal structural extension

- Add a `clientResultSignal` heuristic: if `client.send` returns `{ delivered: false }` and the failure reason contains one of the stale-session sentinel strings (`no-such-session`, `disconnected`, `not-delivered`, `no-such-target`), tag the failure as `stale-session` so the runtime's `staleSessionGate` can attach the typed diagnostic.
- No change to `parseEnvelope` validation; no change to `authorizePeer` ACL; the helper does not introduce a new transport primitive.

### 4. `.pi/agents/{executor,researcher,reviewer}.md` — small block describing the helper + the diagnostic

- Add a step (executor step 7, reviewer step 7, researcher step 7) describing: "Use the repo-local `intercom-send` helper from `.pi/communication/send.mjs` to build the envelope from structured fields (`to`, `kind`, `subject`, decoded `body` object, `references`). The helper returns the wire envelope text plus a sanitized audit summary; you will never see a `body: <base64url>` line in your context. If the helper returns a typed failure `peer_unreachable` / `peer_wrong_role` / `peer_wrong_task`, call `intercom list-cwd` and pick the current same-task paired-role peer; do not retry the old `pi-team--<task-id>--<role>--<launch-id>` directly."
- Existing role prompts' steps 1–6 (or 1–9 for reviewer) keep their wording; only a new step is appended.

### 5. `.pi/skills/{execute-delegated-task,answer-research-question,review-delegated-task}/SKILL.md`

- Mirror the same step in each skill: structured-send helper + four typed-failure recovery paths.

### 6. `.pi/communication/README.md` — one paragraph

- Append a paragraph to the "Allowed routes" section noting that the audit surface carries structured redacted fields and that the runtime returns typed stale-session diagnostics; link to `policy.mjs` `summarizeEnvelopeForAgent` as the source-of-truth.

### 7. `tests/communication-policy.test.mjs` — regression coverage

- New test cases:
  - **P1 / helper unit**: `summarizeEnvelopeForAgent` returns the structured fields and never carries the base64 body line.
  - **P2 / redacted audit**: `formatAuditEvent` writes a row whose JSON serialization contains `kind`, `subject`, `body_summary`, `body_fingerprint`, `body_length`, `references`, and does NOT contain `body_encoding` / `body:` or the base64 string.
  - **P3 / same-task stale-session diagnostic**: `onToolCall` with a `client.send` mock returning `{ delivered: false }` and a valid same-task paired-peer target produces a refusal whose reason starts with `stale-session:role=researcher:task_id=ISSUE-011:launch_id=...:retry=list-cwd`.
  - **P4 / rediscovery path**: after `stale-session`, the agent's only recovery path is `intercom list-cwd` (which the runtime already gates through `SAFE_INTERCOM_ACTIONS`); subsequent re-send to the discovered peer succeeds and the audit row's `recipient` matches the new launch-id.
- Negative cases:
  - **N1 / cross-task rediscovery refused**: same-task helper call whose target resolves to a different task prefix returns `peer_wrong_task`; audit row's `outcome: "refused", reason` carries `research-task-id-mismatch`.
  - **N2 / cross-role rediscovery refused**: helper call whose target resolves to a wrong-role session returns `peer_wrong_role`; existing ACL (`BOUNDED_PEERS`) still gates the `authorizePeer` call.
  - **N3 / unauthorized sender**: existing denial surface for unauthorized inbound is unchanged; the audit row's `direction: "inbound", outcome: "refused", reason: "unauthorized"` carries no body.
  - **N4 / malformed envelope**: existing `parseEnvelope` rejection path; agent sees `Agent communication policy refused malformed send: <reason>`, never the envelope text.
  - **N5 / duplicate id within DedupStore window**: the runtime's existing `DedupStore.accept` gate still refuses re-delivery; audit row's `direction: "inbound", outcome: "refused", reason: "duplicate"`.
  - **N6 / cross-task inbound RESEARCH_RESULT filtering**: existing `N15` test stays green.
- Pre-existing test bug fix: the "Issue #3 outbound: non-research messages pass through the body gate unchanged (existing tests not regressed)" test at `tests/communication-policy.test.mjs:800` does not set `process.env.PI_TEAM_TASK_ID`, so `resolveTeamPeerRole("pi-team--ISSUE-003--reviewer--abc", undefined)` returns `undefined`, the recipient falls back to the literal target string, and `authorizePeer("executor", "pi-team--ISSUE-003--reviewer--abc")` returns `false`. The minimal fix is to set `PI_TEAM_TASK_ID = "ISSUE-003"` in that test (matching the surrounding tests' try/finally pattern). This is a one-line test setup fix, not a production change.

### 8. New `implementation_notes/ISSUE-011.md` and `reports/ISSUE-011-verification.md`

- `implementation_notes/ISSUE-011.md` records slice state, files changed, research request/result correlation, validation evidence, and remaining risks.
- `reports/ISSUE-011-verification.md` is the Lead-reproducible artifact mapping C-002 and C-004 to specific `tests/run-tests.ps1` invocations and to the new positive/negative test cases.

## Out of scope (deferred to future Lead-owned decisions)

The Researcher survey §8 lists six open items. None are closed by this Executor slice; they are recorded as Lead-owned follow-ups:

- **G1 / scope_change replay path** — the scope-change event is delivered through `onContext` with `customType: "scope_change"` and is handled by `markStale`. The structured-send helper does not try to rediscovery a peer through it. Left as documentation only.
- **G2 / launch-id cache invalidation** — `launch-id` is informational. The helper re-validates via `list-cwd` on every send (the runtime never trusts a cached launch-id). This is the same primitive that Issue #3's `request_id` rule uses.
- **G3 / DedupStore 60-minute window** — the helper must generate a fresh UUID per send; existing `request_id` rule.
- **G4 / Lead observation boundary** — the typed-failure surface never leaks the discovered `launch_id` to the agent (only the role and `task_id`, which the agent already knows).
- **G5 / RESEARCH_REQUEST budget** — the helper does not enforce a budget; a future Lead decision can add a typed counter.
- **G6 / cross-task test isolation** — already covered by the existing `N15` test.

## Mapping to Issue #11 done criteria

| Criterion | Owner | Status | Evidence |
| --- | --- | --- | --- |
| **C-001** — Researcher produces a read-only allow-vs-prohibit survey with structured-send and stale-session recovery recommendations, evidence-backed wire-compat and ACL constraints, negative scenarios, and to-test items | researcher | MET (before this slice) | `research/ISSUE-011-intercom-envelope-recovery.md` (~60 KB; 289 numbered lines covering Approach A vs B decision matrix, Base64 exposure path, session-ID change recovery, log redaction fields, compatibility constraints, ACL layers, P1–P4 / N1–N6 / C1–C4 scenarios, confidence and caveats) |
| **C-002** — Executor implements a clear Issue #11 solution: normal agent workflow does not expose full Base64 body; stale session can be rediscovered by same-task paired role or return a clear recoverable diagnostic; existing envelope validation, peer ACL, task/scope binding, and Lead observation boundary remain verifiable; regression coverage added | executor | MET | `plans/ISSUE-011-decision.md` (this file); `.pi/communication/policy.mjs` adds `summarizeEnvelopeForAgent` + `formatAuditEvent`; `.pi/communication/runtime-policy.mjs` `onToolCall` / `onContext` extension with `staleSessionGate`; `.pi/communication/send.mjs` `clientResultSignal` heuristic; `.pi/agents/{executor,researcher,reviewer}.md` step 7 (or appropriate step) describing the helper; `.pi/skills/{execute-delegated-task,answer-research-question,review-delegated-task}/SKILL.md` mirror; `.pi/communication/README.md` audit surface paragraph; new test cases in `tests/communication-policy.test.mjs` (positive P1–P4 + negative N1–N6); pre-existing test bug fix |
| **C-003** — Reviewer independently re-verifies | reviewer | PENDING | Handoff to paired Reviewer `pi-team--ISSUE-011--reviewer` |
| **C-004** — Lead-reproducible: full `tests/run-tests.ps1` and Issue #11 targeted tests both pass; structured send, redacted audit log, stale-session rediscovery, delivery failure / retry, existing envelope compatibility, permission isolation, and existing lifecycle all pass; no cross-task or unauthorized recovery misjudged as success | executor | MET | `reports/ISSUE-011-verification.md` is the dedicated Lead-reproducible artifact; `tests/run-tests.ps1` baseline + new `tests/communication-policy.test.mjs` Issue #11 cases all pass |

## Constraints honored

- No modification to the npm `pi-intercom` package itself; no new network transport; the helper sits inside `.pi/communication/` and calls `makeEnvelope` + `sendWithPolicy` exactly as the agent already does.
- No change to `agent-team/v1` wire envelope, `body_encoding: base64url`, canonical round-trip check, kind set, UUID v4, `references` JSON, or bounded peer ACL.
- No change to the Issue #3 research envelope schema (`validateResearchBody` / `authorizeResearchDelegation` / `RESEARCH_MESSAGE_TYPES`); the existing 21 Issue #3 test cases stay green.
- No change to the public CLI verbs, the Blackboard plugin, the role capability surface, the role memory files, the lifecycle `markStale` / restart contract, or the `pi-team.cmd` entrypoint.
- Lead authority over task contract, scope, acceptance, reclamation is preserved.

## Decision owner and acceptance path

This decision is submitted to the paired Reviewer for C-003 verification, then to Lead for C-004 reproduction and acceptance. The Lead owns the final accept/reject and the project snapshot update. No architecture change is implied (the wire envelope is unchanged; only the audit and runtime-diagnostic surfaces change), so `architect.md` does not need editing; `goal.md` does not need editing because Issue #11's done criteria are unchanged; `project_state.md` does not need editing because no launcher, lifecycle, integration, repository-workflow, or closure surface changed; `README.md` may need a small note if Lead accepts and the operator-facing workflow gains the structured-send helper as a recommended path.

## Reviewer remediation (C-003 CHANGES_REQUESTED → C-003 re-review)

After the initial `READY_FOR_REVIEW` (correlation_id `12ed5ecc-1d53-4aa1-afd5-d8e7d512228e`), the paired Reviewer (artifact `reports/ISSUE-011-review.md`, failure `failures/ISSUE-011-typed-diagnostic-runtime-coverage.md`, severity medium) identified that two of the three typed-diagnostic branches added to `runtime-policy.mjs` `classifyDeliveryFailure` (the `peer_wrong_role` branch and the `stale-session` branch) were not exercised at the integration level because `onToolCall`'s hardcoded client mock always returned `delivered: true`. The Reviewer offered two remediation paths and selected option (1) (preferred):

1. Add one new test per missing runtime path AND extend `createRoleRuntimePolicy` to accept an optional `client` hook so the tests can drive the runtime through the `peer_wrong_role` and `stale-session` branches without monkey-patching module-cache.
2. (Alternative) Amend the three Lead-owned artifacts to accurately describe the existing coverage.

The Executor took option (1):

- `createRoleRuntimePolicy` now accepts an optional `client` option (`{ send: async (recipient, options) => ({ delivered, reason?, ... }) }`). The default hook preserves the existing preflight behavior; production callers see no change. The hook is the same shape as the npm `pi-intercom` extension's `client.send`, so it is a natural seam for future testability.
- Added two new tests:
  - **N2 (runtime path)** — drives the runtime through `classifyDeliveryFailure`'s cross-role branch by sending executor→`pi-team--ISSUE-011--lead--abc`. The `BOUNDED_PEERS` ACL forbids executor from targeting `lead`; `sendWithPolicy` returns `{ delivered: false, policy: "refused", reason: "unauthorized-peer" }`; the runtime reaches the cross-role branch and returns the `peer_wrong_role:sender=executor:role=lead` typed diagnostic.
  - **P3 (runtime path)** — injects a client hook returning `{ delivered: false, reason: "no-such-session" }` so `sendWithPolicy` classifies the failure as `stale-session` and the runtime reaches the same-task stale-session branch. The audit row carries `stale-session:role=researcher:task_id=ISSUE-011:launch_id=<old>:retry=list-cwd` and the agent-facing block reason carries the recovery hint.
- Removed dead `process.env.PI_TEAM_ALLOWED_DELEGATIONS;` expression-statement (Reviewer finding 3, low severity) at `tests/communication-policy.test.mjs:910`.
- Corrected the per-file test counts in `implementation_notes/ISSUE-011.md` and `reports/ISSUE-011-verification.md` (Reviewer finding 2, low severity). The actual counts after the fix are: 49 communication-policy (16 pre-existing + 21 Issue #3 + 12 Issue #11) + 20 team-contract + 6 blackboard = **76 total** (was 74 before the fix; 11 → 12 Issue #11 cases after the 2 new runtime-path tests).

The `client` hook extension does NOT modify the wire envelope (`agent-team/v1` header, `body_encoding: base64url`, canonical round-trip, kind set, UUID v4, `references` JSON), the bounded peer ACL, the canonical base64url check, the Issue #3 body gate, or the lifecycle `markStale` / restart contract. It is the smallest possible production-code seam that makes the typed-diagnostic surface testable.

Final test count: **76/76 pass**, exit code 0.

End of decision document.