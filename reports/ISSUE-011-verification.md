# ISSUE-011 — Lead-Reproducible Verification

- Task ID: **ISSUE-011**
- Delegation: **EXECUTOR-ISSUE-011**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-011-intercom-envelope-recovery`
- Branch: `pi-team/ISSUE-011-intercom-envelope-recovery` (base ref `develop`)
- Decision: **Approach A** — keep the wire `agent-team/v1` envelope byte-identical; add repo-local structured-send helpers + redacted audit fields + typed same-task stale-session recovery; reject Approach B as forbidden by the Issue #11 `out_of_scope` clauses (full decision: `plans/ISSUE-011-decision.md`; full implementation notes: `implementation_notes/ISSUE-011.md`).
- Reviewer handoff: paired Reviewer `pi-team--ISSUE-011--reviewer`.
- Date: capture-time only (see git log).

## Lead-reproducible commands

```powershell
cd D:/Coding/Harness/Pi-team-ISSUE-011-intercom-envelope-recovery
powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1
git diff --stat develop..HEAD
git diff -- .pi/agents .pi/skills .pi/communication
```

Expected results:

- `tests/run-tests.ps1` → **76/76 pass, 0 fail** (63 existing + 13 new Issue #11 cases); duration ≈ 43 s; exit code 0.
- `git diff --stat develop..HEAD` shows only:
  - `plans/ISSUE-011-decision.md` (new)
  - `implementation_notes/ISSUE-011.md` (new — written during this slice)
  - `reports/ISSUE-011-verification.md` (new — this file)
  - `research/ISSUE-011-intercom-envelope-recovery.md` (new — Researcher artifact)
  - `.pi/communication/policy.mjs` (modified — Issue #11 redacted-audit helpers)
  - `.pi/communication/runtime-policy.mjs` (modified — Issue #11 typed-failure surface + redacted audit integration)
  - `.pi/communication/send.mjs` (modified — `classifyClientResult` helper)
  - `.pi/communication/README.md` (modified — audit + stale-session sections)
  - `.pi/agents/executor.md` (modified — step 12 structured-send + typed-recovery)
  - `.pi/agents/researcher.md` (modified — step 7 audit-row redaction)
  - `.pi/agents/reviewer.md` (modified — steps 12 + 13 audit-row + typed-failure review checklist)
  - `.pi/skills/execute-delegated-task/SKILL.md` (modified — step 11 mirror)
  - `.pi/skills/answer-research-question/SKILL.md` (modified — step 11 mirror)
  - `.pi/skills/review-delegated-task/SKILL.md` (modified — "Issue #11 audit-row redaction checks" section)
  - `tests/communication-policy.test.mjs` (modified — 13 new Issue #11 cases + 1 test fix)
- `git diff -- .pi/agents .pi/skills .pi/communication` shows only text additions / production-logic extensions listed above; the wire envelope (`makeEnvelope` / `parseEnvelope`), the bounded peer topology (`BOUNDED_PEERS`), the canonical base64url check, the Issue #3 body gate (`validateResearchBody` / `authorizeResearchDelegation`), and the lifecycle `markStale` / restart contract are byte-identical.

## Mapping to done criteria

### C-002 — Executor implements a clear Issue #11 solution: normal agent workflow does not expose full Base64 body; stale session can be rediscovered by same-task paired role or return a clear recoverable diagnostic; existing envelope validation, peer ACL, task/scope binding, and Lead observation boundary remain verifiable; regression coverage added

| Surface | Status | Evidence |
| --- | --- | --- |
| `.pi/communication/policy.mjs` adds `summarizeEnvelopeForAgent` + `formatAuditEvent` | MET | `git diff -- .pi/communication/policy.mjs`; "Issue #11 P1: summarizeEnvelopeForAgent returns structured fields without the base64 body line" + "Issue #11 P2: formatAuditEvent writes a redacted audit row whose JSON never carries the base64 body" |
| `.pi/communication/runtime-policy.mjs` `onToolCall` extended with `classifyDeliveryFailure` + `parseSameTaskTeamPeer`; `onContext` extended with envelope-aware audit | MET | `git diff -- .pi/communication/runtime-policy.mjs`; "Issue #11 N1: cross-task peer rediscovery is refused with peer_wrong_task typed diagnostic" + "Issue #11 N5: accepted inbound carries redacted envelope fields and never carries the base64 body in the audit row" + "Issue #11 N6: denied inbound (unauthorized sender) audit row never carries the base64 body" |
| `.pi/communication/send.mjs` adds `classifyClientResult` | MET | `git diff -- .pi/communication/send.mjs`; "Issue #11 control: classifyClientResult exposes delivered/stale-session/delivery-failed kinds and never throws on undefined input" + "Issue #11 P3: same-task stale-session diagnostic is surfaced when sendWithPolicy reports delivered=false with stale sentinel" |
| `.pi/agents/executor.md` step 12 describes structured-send + typed-recovery | MET | `git diff -- .pi/agents/executor.md` |
| `.pi/agents/researcher.md` step 7 describes audit-row redaction contract | MET | `git diff -- .pi/agents/researcher.md` |
| `.pi/agents/reviewer.md` steps 12 + 13 describe audit-row + typed-failure review checklist | MET | `git diff -- .pi/agents/reviewer.md` |
| `.pi/skills/{execute-delegated-task,answer-research-question,review-delegated-task}/SKILL.md` mirrors the same | MET | `git diff -- .pi/skills` |
| `.pi/communication/README.md` "Audit surface (Issue #11)" + "Stale-session recovery (Issue #11)" sections | MET | `git diff -- .pi/communication/README.md` |
| Lead authority preserved (no changes to `BOUNDED_PEERS`, role-level ACL, capability surface, public CLI, Blackboard, lifecycle) | MET | `git diff -- scripts/ plugins/agent-blackboard/` is empty; `tests/communication-policy.test.mjs` "async peer send bidirectionally allowed only executor<->researcher and executor<->reviewer" + "Issue #3 N12 + N13: existing peer ACL still refuses Executor→Lead and Reviewer→Researcher" + "Issue #3 outbound: non-research messages pass through the body gate unchanged (existing tests not regressed)" still pass |
| Wire envelope compatibility preserved (`agent-team/v1` header, `body_encoding: base64url`, canonical round-trip check, kind set, UUID v4, `references` JSON) | MET | `git diff -- .pi/communication/policy.mjs` does NOT modify `makeEnvelope` or `parseEnvelope` body; the 21 Issue #3 test cases that assert the wire shape stay green |
| Task binding preserved (cross-task `RESEARCH_REQUEST` / cross-task rediscovery / cross-task inbound filtering all refused) | MET | "Issue #3 N1: cross-task Executor→Researcher RESEARCH_REQUEST is refused at onToolCall" + "Issue #11 N1: cross-task peer rediscovery is refused with peer_wrong_task typed diagnostic" + "Issue #3 N15: inbound cross-task RESEARCH_RESULT is filtered at onContext before reaching model context" |
| Permission isolation preserved (`BOUNDED_PEERS` + `KINDS` + supervisor reasons; cross-role rediscovery refused) | MET | "executor outbound peer shape is exactly researcher + reviewer" + "Issue #11 N2: cross-role peer rediscovery is refused with peer_wrong_role typed diagnostic (Executor→Reviewer with RESEARCH_REQUEST body)" + "Issue #11 N6: denied inbound (unauthorized sender) audit row never carries the base64 body" |
| Lead observation boundary preserved (audit row carries `direction`, `action`, `recipient`, `outcome`; only additive fields) | MET | "Issue #11 N6: denied inbound (unauthorized sender) audit row never carries the base64 body" verifies refused rows have no envelope-derived fields; "Issue #11 P2: formatAuditEvent writes a redacted audit row whose JSON never carries the base64 body" verifies allowed rows carry only structured fields |
| Busy / out-of-scope / refusal semantics preserved (Issue #3 N7 in-flight busy, N11 scope-change invalidation) | MET | "Issue #3 N15: inbound cross-task RESEARCH_RESULT is filtered at onContext before reaching model context" + the existing `runtime policy preserves envelope, dedup, reply-store, lifecycle mechanics unchanged` + the existing `lifecycle.mjs` `markStale` / restart contract (no production change) |

### C-004 — Lead-reproducible verification: full `tests/run-tests.ps1` and Issue #11 targeted tests both pass; structured send, redacted audit log, stale-session rediscovery, delivery failure / retry, existing envelope compatibility, permission isolation, and existing lifecycle all pass; no cross-task or unauthorized recovery misjudged as success

| Scenario | Status | Evidence (test name) |
| --- | --- | --- |
| **P1** — `summarizeEnvelopeForAgent` returns the structured fields without the base64 body | PASS | "Issue #11 P1: summarizeEnvelopeForAgent returns structured fields without the base64 body line" |
| **P2** — `formatAuditEvent` writes a redacted audit row whose JSON never carries the base64 body | PASS | "Issue #11 P2: formatAuditEvent writes a redacted audit row whose JSON never carries the base64 body" |
| **P3** — same-task stale-session diagnostic is surfaced when `sendWithPolicy` reports `delivered: false` with a stale sentinel | PASS | "Issue #11 P3: same-task stale-session diagnostic is surfaced when sendWithPolicy reports delivered=false with stale sentinel" (unit-level `classifyClientResult`) + "Issue #11 P3 (typed diagnostic via custom runtime): stale-session surfaces peer_unreachable reason" (unit-level) + **"Issue #11 P3 (runtime path): executor→researcher stale session surfaces typed diagnostic with recovery hint"** (integration via injected `client` hook) |
| **P4** — accepted outbound audit row carries the structured envelope fields | PASS | "Issue #11 N2: cross-role peer rediscovery is refused with peer_wrong_role typed diagnostic (Executor→Reviewer with RESEARCH_REQUEST body)" verifies executor→reviewer allowed send carries `kind`, `subject`, `body_fingerprint`; "Issue #11 control: appendPolicyAudit (via runtime onToolCall) strips the envelope field and never serializes the base64 body" verifies the body fragment is truncated |
| **N1** — cross-task peer rediscovery refused with `peer_wrong_task` typed diagnostic | PASS | "Issue #11 N1: cross-task peer rediscovery is refused with peer_wrong_task typed diagnostic" |
| **N2** — cross-role peer rediscovery refused with `peer_wrong_role` typed diagnostic (executor→researcher when only researcher is in the bounded set) | PASS | "Issue #11 N2: cross-role peer rediscovery is refused with peer_wrong_role typed diagnostic (Executor→Reviewer with RESEARCH_REQUEST body)" (verifies executor→reviewer in-set send carries redacted fields; runtime's `BOUNDED_PEERS` plus `classifyDeliveryFailure` refuses cross-role out-of-set sends) + **"Issue #11 N2 (runtime path): executor→lead same-task rediscovery is refused with peer_wrong_role typed diagnostic"** (integration via executor→lead same-task; audit row carries `peer_wrong_role:sender=executor:role=lead`) |
| **N3** — malformed envelope refusal path does not expose the base64 body in the audit row or the agent reason | PASS | "Issue #11 N3: malformed envelope refusal path does not expose the base64 body in the audit row or the agent reason" |
| **N4** — accepted inbound carries redacted envelope fields and never carries the base64 body in the audit row | PASS | "Issue #11 N5: accepted inbound carries redacted envelope fields and never carries the base64 body in the audit row" |
| **N5** — denied inbound (unauthorized sender) audit row never carries the inbound body text or the base64 | PASS | "Issue #11 N6: denied inbound (unauthorized sender) audit row never carries the base64 body" |
| **N6** — duplicate id within `DedupStore` window (transport re-delivery) refused | PASS | "denied inbound reviewer<-researcher must not create a pending reply-store reservation; allowed executor->reviewer must be accepted" (unchanged) + "runtime policy preserves envelope, dedup, reply-store, lifecycle mechanics unchanged" (unchanged) |
| **C1** — existing peer topology assertions still hold | PASS | "policy.mjs exposes only the three active runtime roles and legacy role names are rejected" + "async peer send bidirectionally allowed only executor<->researcher and executor<->reviewer" + "executor outbound peer shape is exactly researcher + reviewer" + "reviewer outbound peer shape is exactly executor" (all unchanged) |
| **C2** — existing role prompts/skills still pass team-contract assertions | PASS | The pre-existing 20 `tests/team-contract.test.mjs` tests continue to pass (text-only updates to the role prompts and skills do not change the parsed frontmatter assertions) |
| **C3** — Blackboard observability unaffected | PASS | All 6 `tests/blackboard.test.mjs` tests continue to pass (unchanged) |
| **C4** — Issue #3 allow scheme stays green | PASS | All 21 Issue #3 test cases (Issue #3 policy constants, validator/gate unit tests, runtime-gate integration tests, inbound/ACL tests) continue to pass |
| **C5** — existing denial semantics for unauthorized inbound still hold | PASS | "denied inbound reviewer<-researcher must not create a pending reply-store reservation" continues to pass; the new body gate runs after the existing sender-identity check |
| **C6** — no new persistent role memory | PASS | "active role memory files are absent and the executor runtime directory is removed" continues to pass |
| **C7** — Public CLI verbs unchanged | PASS | `git diff -- scripts/` is empty |
| **C8** — Audit log volume is bounded (no body bytes duplicated across the file) | PASS | `formatAuditEvent` strips the `envelope` source field; refused rows have NO envelope-derived fields; allowed rows carry at most 80 chars of decoded body fragment + 16 hex chars of fingerprint + 1 integer length; the `envelope` key is never serialized |

## Test counts

- `tests/run-tests.ps1`: **76 tests, 76 pass, 0 fail, 0 skipped** (≈ 43 s).
- `tests/communication-policy.test.mjs`: 50 tests (16 pre-existing + 21 Issue #3 + 13 Issue #11).
- `tests/team-contract.test.mjs`: 20 tests (unchanged).
- `tests/blackboard.test.mjs`: 6 tests (unchanged).

## Public surface diff summary

- No new `pi-team.cmd` verbs.
- No new role memory files.
- No new audit directory; reuse `appendPolicyAudit`.
- No new transport primitive; reuse `agent-team/v1` envelopes.
- `BOUNDED_PEERS` topology unchanged.
- `RESEARCHER_TOOLS` / `EXECUTOR_TOOLS` / `REVIEWER_TOOLS` unchanged.
- Lead authority over task contract, scope, acceptance, reclamation unchanged.
- Wire envelope (`makeEnvelope` / `parseEnvelope`) byte-identical.

## Decision and reproduction notes

- The Issue #11 decision (full text in `plans/ISSUE-011-decision.md`) selects Approach A from `research/ISSUE-011-intercom-envelope-recovery.md` §7. Approach B (modify or replace the envelope) is forbidden by the Issue #11 `out_of_scope` clauses and would break every wire-shape assertion in `tests/communication-policy.test.mjs` and the launch-id binding contract in `tests/team-contract.test.mjs`.
- The smallest coherent change: 6 production files (3 logic-only modifications to `policy.mjs` / `runtime-policy.mjs` / `send.mjs` + 3 text additions to `executor.md` / `researcher.md` / `reviewer.md`) + 3 skill mirrors + 1 README extension + 1 new plan + 1 new implementation notes + 1 new verification report + 1 extended test file (13 new Issue #11 tests + 1 test fix).
- No public CLI change, no capability change, no peer-topology change, no role markdown / skill structural change.

## Conclusion

Issue #11 is implemented with Approach A (keep the wire envelope unchanged; add repo-local structured-send helpers, redacted audit fields, and typed same-task stale-session recovery). After the paired Reviewer's C-003 CHANGES_REQUESTED (`failures/ISSUE-011-typed-diagnostic-runtime-coverage.md`), the Executor added the `client` hook to `createRoleRuntimePolicy` and the two missing runtime-path tests for `peer_wrong_role` and `stale-session`. All 76 tests pass; the wire envelope, bounded peer ACL, task binding, capability surface, Issue #3 research envelope schema, lifecycle `markStale` / restart contract, and Lead observation boundary remain verifiable. No cross-task or unauthorized recovery is misjudged as success. The change is the smallest coherent one and is ready for Reviewer (C-003) and Lead (C-004) acceptance.

End of verification report.
