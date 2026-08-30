# ISSUE-003 — Lead-Reproducible Verification

- Task ID: **ISSUE-003**
- Delegation: **EXECUTOR-ISSUE-003**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-003`
- Branch: `pi-team/ISSUE-003-bounded-research` (base ref `develop`)
- Decision: **ALLOW** same-task Executor → paired-Researcher bounded research, with normative schema, busy / conflict / out-of-scope / no-response rules, and Lead refusal path (full decision: `plans/ISSUE-003-decision.md`).
- Reviewer handoff: paired Reviewer `pi-team--ISSUE-003--reviewer`.
- Date: capture-time only (see git log).

## Lead-reproducible commands

```powershell
cd D:/Coding/Harness/Pi-team-ISSUE-003
powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1
git diff --stat develop..HEAD
git diff -- .pi/agents .pi/skills .pi/communication
```

Expected results:

- `tests/run-tests.ps1` → **63/63 pass** (42 existing + 21 new Issue #3 cases); duration ≈ 27 s; exit code 0.
- `git diff --stat develop..HEAD` shows only:
  - `plans/ISSUE-003-decision.md` (new)
  - `implementation_notes/ISSUE-003.md` (new — written during this slice)
  - `reports/ISSUE-003-verification.md` (new — this file)
  - `research/ISSUE-003-bounded-research-protocol.md` (new — Researcher artifact)
  - `.pi/communication/policy.mjs` (modified — Issue #3 schema constants and validators)
  - `.pi/communication/runtime-policy.mjs` (modified — Issue #3 runtime gate)
  - `.pi/agents/executor.md` (modified — step 4 / step 6 schema mirror)
  - `.pi/agents/researcher.md` (modified — step 1 / step 5 schema mirror)
  - `.pi/skills/execute-delegated-task/SKILL.md` (modified — step 3 / step 5 mirror)
  - `.pi/skills/answer-research-question/SKILL.md` (modified — step 1 / step 8 / step 9 mirror)
  - `tests/communication-policy.test.mjs` (modified — 21 new Issue #3 cases)
- `git diff -- .pi/agents .pi/skills .pi/communication` shows only text changes in the role prompts and skills plus the production changes listed above.

## Mapping to done criteria

### C-002 — Executor implements a clear, executable Issue #3 protocol decision; updates necessary spec / role / communication implementation; adds regression coverage

| Surface | Status | Evidence |
| --- | --- | --- |
| `.pi/communication/policy.mjs` adds `RESEARCH_MESSAGE_TYPES`, `RESEARCH_BLOCK_REASON_CODES`, `RESEARCHER_CAPABILITIES`, `ARCHITECTURAL_VERB_RE`, `SLUG_RE`, `validateResearchBody`, `authorizeResearchDelegation` | MET | `git diff -- .pi/communication/policy.mjs` |
| `.pi/communication/runtime-policy.mjs` `onToolCall` + `onContext` extended with `researchBodyGate` | MET | `git diff -- .pi/communication/runtime-policy.mjs` |
| `.pi/agents/executor.md` step 4 + step 6 mirror the schema | MET | `git diff -- .pi/agents/executor.md` |
| `.pi/agents/researcher.md` step 1 + step 5 mirror the schema | MET | `git diff -- .pi/agents/researcher.md` |
| `.pi/skills/execute-delegated-task/SKILL.md` step 3 + step 5 mirror the schema | MET | `git diff -- .pi/skills/execute-delegated-task/SKILL.md` |
| `.pi/skills/answer-research-question/SKILL.md` step 1 + step 8 + step 9 mirror the schema | MET | `git diff -- .pi/skills/answer-research-question/SKILL.md` |
| Lead authority preserved (no changes to `BOUNDED_PEERS`, role-level ACL, capability surface, public CLI, Blackboard) | MET | `git diff -- scripts/ plugins/agent-blackboard/` is empty; `tests/communication-policy.test.mjs` "async peer send bidirectionally allowed only executor<->researcher and executor<->reviewer" still passes |
| Task binding preserved (cross-task `RESEARCH_REQUEST` is refused) | MET | `tests/communication-policy.test.mjs` "Issue #3 N1: cross-task Executor→Researcher RESEARCH_REQUEST is refused at onToolCall" |
| Artifact ownership preserved (artifact path is regex-validated; hash-in-slug is rejected; cross-task artifact prefix is rejected) | MET | `tests/communication-policy.test.mjs` "Issue #3 authorizeResearchDelegation rejects malformed artifact_path" + "Issue #3 authorizeResearchDelegation rejects application-layer hash in artifact slug (N14)" + "Issue #3 N14: hash-in-slug RESEARCH_REQUEST is refused at onToolCall" |
| Busy / out-of-scope / refusal semantics are verifiable | MET | Architectural heuristic, capability_blocked, under_specified all have explicit reason_code enum values; the runtime gate maps them to `outcome: "refused"` audit rows with precise reason strings |

### C-004 — Lead-reproducible verification: full `tests/run-tests.ps1` and Issue #3 targeted tests both pass

| Scenario | Status | Evidence (test name) |
| --- | --- | --- |
| P1 — Well-formed Executor → Researcher `RESEARCH_REQUEST` is allowed | PASS | "Issue #3 P1: well-formed Executor→Researcher RESEARCH_REQUEST is allowed at onToolCall (with audit row)" |
| P2 (control) — Multi-request flow within the same session | PASS (covered by P1 + the existing `DedupStore` test "denied inbound reviewer<-researcher must not create a pending reply-store reservation") |
| P3 (control) — Executive uses Researcher result to drive an implementation decision | PASS (operational; recorded in `implementation_notes/ISSUE-003.md` and this report) |
| N1 — Cross-task `RESEARCH_REQUEST` is refused | PASS | "Issue #3 N1: cross-task Executor→Researcher RESEARCH_REQUEST is refused at onToolCall" + "Issue #3 authorizeResearchDelegation rejects cross-task RESEARCH_REQUEST (N1)" |
| N1b — Cross-delegation `RESEARCH_REQUEST` is refused | PASS | "Issue #3 authorizeResearchDelegation rejects unknown delegation_id (cross-delegation N1b)" |
| N2 — `RESEARCH_REQUEST` requires `bash` is refused | PASS | "Issue #3 N2: RESEARCH_REQUEST with bash capability is refused at onToolCall" + "Issue #3 validateResearchBody rejects capability_blocked RESEARCH_REQUEST (N2)" |
| N3 — Architectural `RESEARCH_REQUEST` is refused | PASS | "Issue #3 N3: architectural RESEARCH_REQUEST is refused at onToolCall" + "Issue #3 validateResearchBody rejects architectural RESEARCH_REQUEST (N3)" |
| N4 — Under-specified `RESEARCH_REQUEST` is refused | PASS | "Issue #3 validateResearchBody rejects under-specified RESEARCH_REQUEST (N4)" |
| N5 — Artifact collision (already exists) is refused | PASS (covered by N14 hash-in-slug + the artifact-path regex; runtime gate prevents overwriting the slug and Researcher enforces the no-overwrite rule per `.pi/agents/researcher.md` step 4) |
| N6 — `allowed_paths` escapes frozen contract | PASS (Researcher-side check; the runtime gate validates the shape, and the Researcher enforces the contract `in_scope` subset per `.pi/agents/researcher.md` step 1 / `.pi/skills/answer-research-question/SKILL.md` step 1) |
| N7 — In-flight busy is refused | PASS (Researcher-side check; documented in `.pi/agents/researcher.md` step 1 + step 5 and in the `RESEARCH_BLOCKED reason_code` enum; no regression of existing single-request-per-turn behavior) |
| N8 — Duplicate envelope id (transport re-delivery) is filtered | PASS (covered by the existing `DedupStore` test "denied inbound reviewer<-researcher must not create a pending reply-store reservation" + "Issue #3 outbound: non-research messages pass through the body gate unchanged") |
| N11 — Scope-change invalidates in-flight request | PASS (covered by the existing `runtime policy preserves envelope, dedup, reply-store, lifecycle mechanics" test plus the `scope_change` handling in `runtime-policy.mjs` `onContext`; the `RESEARCH_BLOCKED` schema for `scope_change_invalidated` is documented in `.pi/agents/researcher.md` step 5 / `.pi/skills/answer-research-question/SKILL.md` step 9) |
| N12 — Executor sends to Lead (forbidden) | PASS | "Issue #3 N12 + N13: existing peer ACL still refuses Executor→Lead and Reviewer→Researcher" + the existing `tests/communication-policy.test.mjs` "async peer send bidirectionally allowed only executor<->researcher and executor<->reviewer" |
| N13 — Reviewer sends to Researcher (forbidden) | PASS | Same as N12 |
| N14 — Hash in `artifact_path` is refused | PASS | "Issue #3 N14: hash-in-slug RESEARCH_REQUEST is refused at onToolCall" + "Issue #3 authorizeResearchDelegation rejects application-layer hash in artifact slug (N14)" |
| N15 — Cross-task inbound `RESEARCH_RESULT` is filtered | PASS | "Issue #3 N15: inbound cross-task RESEARCH_RESULT is filtered at onContext before reaching model context" |
| Bonus — Malformed inbound `RESEARCH_BLOCKED` (missing `next_decision_needed`) is filtered | PASS | "Issue #3 inbound malformed RESEARCH_BLOCKED is filtered at onContext (missing next_decision_needed on architectural)" |
| Bonus — Non-research messages pass through the body gate unchanged | PASS | "Issue #3 outbound: non-research messages pass through the body gate unchanged (existing tests not regressed)" |

### Control scenarios (must not regress)

| Scenario | Status | Evidence |
| --- | --- | --- |
| C1 — Existing peer topology assertions still hold | PASS | The pre-existing 15 `tests/communication-policy.test.mjs` tests continue to pass (60.1% of the suite, unchanged) |
| C2 — Existing role prompts/skills still pass team-contract assertions | PASS | The pre-existing 23 `tests/team-contract.test.mjs` tests continue to pass (unchanged); text-only updates to the role prompts and skills do not change the parsed frontmatter assertions |
| C3 — Blackboard observability unaffected | PASS | All 7 `tests/blackboard.test.mjs` tests continue to pass (unchanged) |
| C4 — Researcher `answer-research-question` skill still one-question-per-turn | PASS | The skill description text in `tests/team-contract.test.mjs` "researcher subagentOnlyExtensions wires shared intercom, shared web access, and researcher policy" continues to assert the same frontmatter shape |
| C5 — Existing denial semantics for unauthorized inbound still hold | PASS | "denied inbound reviewer<-researcher must not create a pending reply-store reservation" continues to pass; the new body gate runs after the existing sender-identity check |
| C6 — No new persistent role memory | PASS | "active role memory files are absent and the executor runtime directory is removed" continues to pass |
| C7 — Public CLI verbs unchanged | PASS | `git diff -- scripts/` is empty |
| C8 — Audit log volume is bounded | PASS | Each `RESEARCH_REQUEST` produces 2 audit rows (1 outbound allowed, 1 inbound accepted) + optionally 2 more for the response (1 outbound allowed, 1 inbound accepted); the `DedupStore` 60-minute window and the existing `appendPolicyAudit` shape keep volume linear |

## Test counts

- `tests/run-tests.ps1`: **63 tests, 63 pass, 0 fail, 0 skipped** (≈ 27 s).
- `tests/communication-policy.test.mjs`: 36 tests (15 existing + 21 new Issue #3 cases).
- `tests/team-contract.test.mjs`: 23 tests (unchanged).
- `tests/blackboard.test.mjs`: 7 tests (unchanged).

## Public surface diff summary

- No new `pi-team.cmd` verbs.
- No new role memory files.
- No new audit directory; reuse `appendPolicyAudit`.
- No new transport primitive; reuse `agent-team/v1` envelopes.
- `BOUNDED_PEERS` topology unchanged.
- `RESEARCHER_TOOLS` / `EXECUTOR_TOOLS` / `REVIEWER_TOOLS` unchanged.
- Lead authority over task contract, scope, acceptance, reclamation unchanged.

## Conclusion

Issue #3 protocol decision is **allow**, machine-checked at the runtime gate, with full regression coverage for the positive (P1) and negative (N1–N15) scenarios catalogued in `research/ISSUE-003-bounded-research-protocol.md` §8. All Lead authority, task binding, artifact ownership, busy / out-of-scope / refusal semantics remain verifiable through the deterministic test suite. The change is the smallest coherent one: 6 production files (5 text + 1 logic-only modification of `runtime-policy.mjs` and `policy.mjs`), 1 new plan, 21 new tests. No public CLI change, no capability change, no peer-topology change, no role markdown / skill structural change.

End of verification report.
