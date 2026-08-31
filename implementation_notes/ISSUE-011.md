# ISSUE-011 — Implementation Notes (Executor slice)

## Slice

- Lead task ID: **ISSUE-011**
- Delegation ID: **EXECUTOR-ISSUE-011**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-011-intercom-envelope-recovery`
- Branch: `pi-team/ISSUE-011-intercom-envelope-recovery` (base ref `develop`)
- Slice state: **READY_FOR_REVIEW**
- Date: capture-time only (see git log)

## Research request / result correlation

The Researcher (delegation `RESEARCH-ISSUE-011`, capability set `read,grep,find,ls,write,report_to_lead,blackboard_update`) completed the C-001 read-only survey before this Executor slice began. The artifact at `research/ISSUE-011-intercom-envelope-recovery.md` (~60 KB; 289 numbered lines) is the bounded proposal adopted verbatim (Approach A — keep the wire envelope unchanged; add structured-send helpers + redacted audit fields + typed same-task stale-session recovery; refuse Approach B as forbidden by the Issue #11 `out_of_scope` clauses).

- **Request**: implicit through the Lead task contract (C-001 — Researcher read-only surveys the repo-local intercom surfaces, compares allow vs prohibit, and proposes a concrete file-by-file change plan).
- **Artifact**: `research/ISSUE-011-intercom-envelope-recovery.md` §1–§9 (Base64 envelope exposure path, session-ID change recovery boundaries, log redaction fields, compatibility constraints, task/scope/role/peer ACL layers, verifiable P1–P4 / N1–N6 / C1–C4 scenarios, Approach A vs B decision matrix, open gaps, sources).
- **Researcher delivery confirmation** (intercom broker, 2026-08-30T06:26:40Z):
  - correlation_id `b9d4f2e1-3a5c-4b7e-8d9f-1a2b3c4d5e6f`, body `OK\n`, subject `ISSUE-011 C-001 artifact ready: Approach A recommended; Approach B forbidden`.
- **Decision impact**: Approach A. Implemented `summarizeEnvelopeForAgent` + `formatAuditEvent` in `.pi/communication/policy.mjs`; `staleSessionGate` + `classifyDeliveryFailure` + `parseSameTaskTeamPeer` in `.pi/communication/runtime-policy.mjs`; `classifyClientResult` in `.pi/communication/send.mjs`. Added structured fields to the audit row (`kind`, `subject`, `references`, `body_summary` ≤80 chars, `body_fingerprint` 16 hex, `body_length`). Added typed diagnostic reasons (`stale-session:role=...`, `peer_wrong_role:...`, `peer_wrong_task:...`). The wire envelope is byte-identical (same header, same `body_encoding: base64url`, same canonical round-trip check, same kind set, same UUID v4, same `references` JSON). The Issue #3 research envelope schema (`validateResearchBody` / `authorizeResearchDelegation` / `RESEARCH_MESSAGE_TYPES`) is unchanged; the 21 existing Issue #3 test cases stay green.

## Decision (summary; full version in plans/ISSUE-011-decision.md)

**Approach A** — keep the wire `agent-team/v1` envelope byte-identical; add repo-local structured-send helpers + redacted audit fields + typed same-task stale-session recovery; reject Approach B as forbidden by the Issue #11 `out_of_scope` clauses. Lead authority, task/scope/role/peer ACL, the Issue #3 research envelope schema, the lifecycle `markStale` / restart contract, and the Blackboard observability surface are preserved.

## Files changed

| File | Change | Why |
| --- | --- | --- |
| `.pi/communication/policy.mjs` | Added `createHash` import. Added `SUMMARY_FRAGMENT_CHARS = 80`, `SUMMARY_FINGERPRINT_HEX = 16`, `truncateUtf8`, `bodyFingerprint`. Added `summarizeEnvelopeForAgent(envelope)` returning `{ id, correlationId, kind, subject, references, bodySummary, bodyFingerprint, bodyLength }`. Added `formatAuditEvent(role, direction, event, envelope)` building a redacted audit row (strips the `envelope` source field; suppresses envelope-derived fields when `outcome === "refused"`; never serializes the base64 body). No change to `BOUNDED_PEERS`, `KINDS`, `SUPERVISOR_REASONS`, `makeEnvelope`, `parseEnvelope`, `resolvePeerRole`, `resolveTeamPeerRole`, `PolicyReceiver`, `DedupStore`, `LeadAudit`, `MessageQueue`, `RunRegistry`, `RESEARCH_MESSAGE_TYPES`, `RESEARCH_BLOCK_REASON_CODES`, `RESEARCHER_CAPABILITIES`, `validateResearchBody`, `authorizeResearchDelegation`. | Source-of-truth redacted-envelope projection. Wire compatibility is unchanged. |
| `.pi/communication/runtime-policy.mjs` | Added imports for `summarizeEnvelopeForAgent`, `formatAuditEvent`, `ROLES`, `BOUNDED_PEERS`, `classifyClientResult`. Added `STALE_SESSION_PREFIX`, `PEER_WRONG_ROLE_PREFIX`, `PEER_WRONG_TASK_PREFIX` constants. Rewrote `appendPolicyAudit` to use `formatAuditEvent` (strips `envelope` source field, suppresses envelope fields on refused outcomes). Extended `onToolCall` to: (a) attach the parsed envelope to audit rows for redaction; (b) add `classifyDeliveryFailure({ sender, target, sameTaskTarget, isStaleSession })` returning typed diagnostics (`stale-session`, `peer_wrong_role`, `peer_wrong_task`) or `undefined` for opaque failures; (c) add `parseSameTaskTeamPeer(target, currentTaskId)` parser that preserves the original case of the typed task-id and launch-id. Extended `onContext` to attach the parsed envelope to accepted inbound audit rows (refused rows get no envelope-derived fields). | Runtime gate that surfaces typed diagnostics and produces redacted audit rows. |
| `.pi/communication/send.mjs` | Added `STALE_SESSION_SENTINELS` set and `classifyClientResult(result)` helper returning `{ kind: "delivered" \| "stale-session" \| "delivery-failed" \| "unknown", reason? }`. `sendWithPolicy` now classifies the `client.send` result before returning; stale-session failures carry `policy: "stale-session"` so the runtime's `classifyDeliveryFailure` can attach the typed diagnostic. | Classifies transport failures into stale-session vs opaque so the runtime can surface a typed diagnostic. |
| `.pi/agents/executor.md` | Added step 12 describing the structured-send helper, the redacted audit fields, and the four typed-failure recovery paths (`stale-session`, `peer_wrong_role`, `peer_wrong_task`, `unauthorized-peer` / `parseEnvelope` errors). | Teach the Executor the new diagnostic surface and the recovery hint (call `intercom list-cwd`, re-send). |
| `.pi/agents/researcher.md` | Added step 7 describing the redacted inbound audit row on the Executor side; clarifies that the Researcher's outbound `makeEnvelope` is unchanged but the Executor-side audit never carries the raw base64. | Mirror the audit-row redaction contract for the Researcher so the inbound audit row's structured fields are predictable. |
| `.pi/agents/reviewer.md` | Added steps 12 and 13 describing the audit-row redaction checks and the typed-failure surface that Reviewer must verify when reviewing Issue #11 changes. | Teach the Reviewer the new audit-row and typed-failure contract; keep Reviewer's failure-artifact ownership. |
| `.pi/skills/execute-delegated-task/SKILL.md` | Added step 11 mirroring step 12 of the Executor role prompt. | Skills stay in sync with role prompts. |
| `.pi/skills/review-delegated-task/SKILL.md` | Added "Issue #11 audit-row redaction checks" section enumerating the four audit-row assertions Reviewer must verify. | Skills stay in sync with role prompts. |
| `.pi/skills/answer-research-question/SKILL.md` | Added step 11 clarifying the Researcher's outbound construction is unchanged and the inbound audit row carries redacted fields only. | Skills stay in sync with role prompts. |
| `.pi/communication/README.md` | Added "Audit surface (Issue #11)" and "Stale-session recovery (Issue #11)" sections documenting the audit-row redaction contract and the typed-failure recovery paths. | Operator-facing documentation for the audit surface and the typed diagnostics. |
| `plans/ISSUE-011-decision.md` (new) | Decision, scope, mapping to C-002/C-004, constraints honored. | Lead-reproducible artifact for the decision. |
| `tests/communication-policy.test.mjs` | Added 13 new Issue #11 test cases: P1 `summarizeEnvelopeForAgent` returns the structured fields and never carries the base64; P2 `formatAuditEvent` writes a redacted audit row; N1 cross-task peer rediscovery refused with `peer_wrong_task` typed diagnostic; N2 executor→reviewer same-task send carries redacted audit fields; P3 stale-session sentinel classification via `classifyClientResult`; P3-typed `parseSameTaskTeamPeer` preserves case; N3 malformed envelope refusal path does not expose the base64 body; N5 accepted inbound carries redacted envelope fields and never the base64; N6 denied inbound audit row never carries the inbound body text; control `classifyClientResult` exposes delivered/stale-session/delivery-failed kinds; control `appendPolicyAudit` strips the envelope field and never serializes the base64 body; runtime-path N2 verifies executor→lead same-task rediscovery refusal; runtime-path P3 verifies executor→researcher stale-session recovery. Fixed pre-existing test bug at line 800 (the "non-research pass-through" test) which did not set `PI_TEAM_TASK_ID`. | Regression coverage for the Issue #11 redacted-audit + typed-failure surface. |

Total diff: 6 production files (1 new helper module, 1 runtime extension, 1 send-helper extension, 3 role prompt steps + 1 review-prompt audit checklist) + 1 new plan + 1 extended test file + 1 README extension. No changes to `scripts/pi-team.ps1`, the Blackboard plugin, the bounded peer topology, the role capability surface, the public CLI verbs, the role memory files, or the wire envelope format.

## Mapping to Issue #11 done criteria

| Criterion | Owner | Status | Evidence |
| --- | --- | --- | --- |
| **C-001** — Researcher produces a read-only allow-vs-prohibit survey with structured-send and stale-session recovery recommendations, evidence-backed wire-compat and ACL constraints, negative scenarios, and to-test items | researcher | MET (before this slice) | `research/ISSUE-011-intercom-envelope-recovery.md` |
| **C-002** — Executor implements a clear Issue #11 solution: normal agent workflow does not expose full Base64 body; stale session can be rediscovered by same-task paired role or return a clear recoverable diagnostic; existing envelope validation, peer ACL, task/scope binding, and Lead observation boundary remain verifiable; regression coverage added | executor | MET | `plans/ISSUE-011-decision.md`; `.pi/communication/policy.mjs` adds `summarizeEnvelopeForAgent` + `formatAuditEvent`; `.pi/communication/runtime-policy.mjs` `onToolCall` / `onContext` extension with `classifyDeliveryFailure` + `parseSameTaskTeamPeer`; `.pi/communication/send.mjs` `classifyClientResult`; `.pi/agents/{executor,researcher,reviewer}.md` step additions; `.pi/skills/{execute-delegated-task,answer-research-question,review-delegated-task}/SKILL.md` mirror; `.pi/communication/README.md` audit + stale-session sections; 13 Issue #11 test cases in `tests/communication-policy.test.mjs` (including the two runtime-path tests) plus the pre-existing test bug fix |
| **C-003** — Reviewer independently re-verifies | reviewer | PENDING | Handoff to paired Reviewer `pi-team--ISSUE-011--reviewer` |
| **C-004** — Lead-reproducible: full `tests/run-tests.ps1` and Issue #11 targeted tests both pass; structured send, redacted audit log, stale-session rediscovery, delivery failure / retry, existing envelope compatibility, permission isolation, and existing lifecycle all pass; no cross-task or unauthorized recovery misjudged as success | executor | MET | `reports/ISSUE-011-verification.md` is the dedicated Lead-reproducible artifact; `tests/run-tests.ps1` baseline + new `tests/communication-policy.test.mjs` Issue #11 cases all pass (76/76) |

## Validation performed

- `powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1` → **76/76 pass, 0 fail** (≈ 41 s)
  - `tests/communication-policy.test.mjs`: 50 tests (16 pre-existing + 21 Issue #3 + 13 Issue #11)
  - `tests/team-contract.test.mjs`: 20 tests (unchanged; text-only updates to role prompts and skills do not change the parsed frontmatter assertions)
  - `tests/blackboard.test.mjs`: 6 tests (unchanged)
- All Issue #3 test cases (research envelope schema, runtime gate, cross-task refusal, malformed BLOCKED filtering, ACL preservation) stay green. The wire envelope, the canonical base64url check, the bounded peer ACL, and the Issue #3 body gate are byte-identical.
- The pre-existing test bug at `tests/communication-policy.test.mjs:800` ("non-research pass-through" missing `PI_TEAM_TASK_ID`) is fixed by setting `PI_TEAM_TASK_ID = "ISSUE-003"` in the test body, matching the surrounding tests' try/finally pattern. This is a one-line test setup fix; no production-code change.

## Reviewer remediation (C-003 CHANGES_REQUESTED)

The paired Reviewer (artifact `reports/ISSUE-011-review.md`, finding `failures/ISSUE-011-typed-diagnostic-runtime-coverage.md`) identified that two of the three typed-diagnostic branches added to `runtime-policy.mjs` `classifyDeliveryFailure` were not exercised at the integration level because `onToolCall`'s hardcoded client mock always returned `delivered: true`. The Reviewer offered two remediation paths:

1. (Preferred) Add two new runtime-path tests + extend `createRoleRuntimePolicy` to accept an optional `client` hook.
2. (Alternative) Amend the three Lead-owned artifacts to accurately describe the existing coverage.

This Executor slice took option (1):

- Extended `createRoleRuntimePolicy` to accept an optional `client` option (`{ send: async (recipient, options) => ({ delivered, reason?, ... }) }`); the default hook preserves the existing behavior.
- Added two new tests:
  - `Issue #11 N2 (runtime path): executor→lead same-task rediscovery is refused with peer_wrong_role typed diagnostic` — drives the runtime through the cross-role branch by sending to `pi-team--ISSUE-011--lead--abc` (executor is forbidden from targeting `lead` by `BOUNDED_PEERS`); asserts the audit row carries `peer_wrong_role:sender=executor:role=lead` and the agent-facing block reason carries the recovery hint.
  - `Issue #11 P3 (runtime path): executor→researcher stale session surfaces typed diagnostic with recovery hint` — injects a client hook returning `{ delivered: false, reason: "no-such-session" }` to drive the runtime through the stale-session branch; asserts the audit row carries `stale-session:role=researcher:task_id=ISSUE-011:launch_id=stale-launch-A:retry=list-cwd` and the agent-facing block reason carries the recovery hint.
- Removed dead `process.env.PI_TEAM_ALLOWED_DELEGATIONS;` expression-statement (Reviewer finding 3) at `tests/communication-policy.test.mjs:910`.
- The `client` hook extension does NOT modify the wire envelope, the bounded peer ACL, the canonical base64url check, the Issue #3 body gate, or the lifecycle `markStale` / restart contract. The default hook preserves the existing `delivered: true` preflight shape.

The new tests are appended after the existing Issue #11 control tests. The full test suite is now **76/76 pass** (was 74/74 before the fix).

## Remaining risks / open gaps

- **G1 — scope_change replay path** (Researcher §8 G1): the scope-change event is delivered through `onContext` with `customType: "scope_change"` and is handled by `markStale`. The structured-send helper does not try to rediscovery a peer through it. Left as documentation only.
- **G2 — launch-id cache invalidation** (Researcher §8 G2): `launch-id` is informational. The helper re-validates via `list-cwd` on every send (the runtime never trusts a cached launch-id). This is the same primitive that Issue #3's `request_id` rule uses.
- **G3 — DedupStore 60-minute window** (Researcher §8 G3): the helper must generate a fresh UUID per send; existing `request_id` rule.
- **G4 — Lead observation boundary** (Researcher §8 G4): the typed-failure surface never leaks the discovered `launch_id` to the agent beyond what the agent already typed (the runtime preserves the agent's typed case but does not provide the new launch-id; the agent must call `list-cwd` itself).
- **G5 — RESEARCH_REQUEST budget** (Researcher §8 G5): the helper does not enforce a budget; a future Lead decision can add a typed counter.
- **G6 — cross-task test isolation** (Researcher §8 G6): covered by the existing `N15` test and the new `Issue #11 N1` test.
- **G7 — `clientResultSignal` heuristic** (this slice): the stale-session sentinel list is conservative; only `no-such-session`, `session-not-found`, `disconnected`, `not-delivered`, `no-such-target`, and the npm pi-intercom's literal "Session may not exist or has disconnected." trigger the typed diagnostic. Generic failures ("internal error", "rate limited") keep the opaque delivery-failed shape. A future Lead decision can expand the sentinel list when the npm package exposes more granular reasons.
- **G8 — agent prompt "stale-session" recovery hint** (this slice): the agent prompt's step 12 explicitly tells the Executor to call `intercom list-cwd` and re-send. Reviewer should confirm in `reviews/ISSUE-011-review.md` that the prompt text matches the runtime's actual diagnostic reason format (`stale-session:role=...:task_id=...:launch_id=...:retry=list-cwd`).

## Decision owner and acceptance path

This decision is submitted to the paired Reviewer for C-003 verification, then to Lead for C-004 reproduction and acceptance. No architecture change is implied (the wire envelope is unchanged); the bounded peer topology, the role capability surface, the public CLI verbs, the Blackboard observability surface, and the lifecycle `markStale` / restart contract are all preserved. `architect.md`, `goal.md`, and `project_state.md` do not need editing as part of this slice; `README.md` does not need editing at the project root (only `.pi/communication/README.md` gains the new sections).

End of implementation notes.
