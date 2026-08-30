# ISSUE-003 — Implementation Notes (Executor slice)

## Slice

- Lead task ID: **ISSUE-003**
- Delegation ID: **EXECUTOR-ISSUE-003**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-003`
- Branch: `pi-team/ISSUE-003-bounded-research` (base ref `develop`)
- Slice state: **READY_FOR_REVIEW**
- Date: capture-time only (see git log)

## Research request / result correlation

The Researcher (delegation `RESEARCH-ISSUE-003`, capability set `read,grep,find,ls,write,report_to_lead,blackboard_update`) completed the C-001 read-only survey before this Executor slice began. The artifact at `research/ISSUE-003-bounded-research-protocol.md` (59849 bytes; 547 numbered lines) is the bounded proposal adopted verbatim:

- **Request**: implicit through the task contract (C-001 — Researcher read-only surveys Executor / Researcher / Lead / intercom / artifact lifecycles and compares allow vs prohibit).
- **Artifact**: `research/ISSUE-003-bounded-research-protocol.md` §1–§12 (allow/prohibit comparison, schema, busy/duplicate/out-of-scope/no-response rules, Lead refusal paths, Lead-mediated alternative, P1–P3 / N1–N15 / C1–C8 scenarios, recommended scope, open questions, source-of-truth references, confidence).
- **Researcher Blackboard trail** (`<git-common-dir>/harness-blackboard/v1/ISSUE-003-researcher.jsonl`, sequence 1–4):
  - seq 1 (03:06:41Z) — `state: working`, activity "Starting read-only review…"
  - seq 2 (03:08:57Z) — `state: working`, activity "Synthesizing allow vs prohibit comparison…"
  - seq 3 (03:11:47Z) — `state: working`, activity "Artifact persisted at research/ISSUE-003-bounded-research-protocol.md; recommend allow with frozen-contract schema; ready for paired Executor follow-up or Lead acceptance"
  - seq 4 (03:11:52Z) — `state: working`, activity "idle and event-driven for paired Executor follow-ups or Lead acceptance/reclaim"
- **Decision impact**: Allow. Implemented the schema validator (`validateResearchBody`), the task/delegation/capability/artifact gate (`authorizeResearchDelegation`), and the runtime gate extension (`researchBodyGate`) in `runtime-policy.mjs` `onToolCall` and `onContext`. The allow path keeps the active role prompts, the active skill files, the active bounded peer topology, the active capability surface, and the historical Issue #1 `RESEARCH_RESULT` exchange (correlation_id `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`, body `Artifact ready. Confidence: high.`) intact.

## Decision (summary; full version in plans/ISSUE-003-decision.md)

**Allow** same-task Executor → paired-Researcher bounded research, with the field-level schema from research §3, the busy / duplicate / out-of-scope / no-response rules from §5, and the Lead refusal path from §6 made normative and machine-checked at the runtime policy gate. The Lead-owned frozen contract remains the only source of truth for task scope, artifact ownership, and pair identity; Researcher remains on-demand / event-driven; Reviewer is not a participant. Lead retains three refusal levers — pre-send via `report_to_lead`, mid-flight via `scope_change`, and reclamation via `pi-team.cmd accept / close-incomplete`.

## Files changed

| File | Change | Why |
| --- | --- | --- |
| `.pi/communication/policy.mjs` | Added `RESEARCH_MESSAGE_TYPES`, `RESEARCH_BLOCK_REASON_CODES`, `RESEARCHER_CAPABILITIES`, `ARCHITECTURAL_VERB_RE`, `SLUG_RE`. Added `validateResearchBody(type, body)` and `authorizeResearchDelegation(body, { taskId, allowedDelegations })`. No change to `BOUNDED_PEERS`, `makeEnvelope`, `parseEnvelope`, `resolveTeamPeerRole`, `PolicyReceiver`, `DedupStore`, or `LeadAudit`. | Source-of-truth field-level schema for `RESEARCH_REQUEST` / `RESEARCH_RESULT` / `RESEARCH_BLOCKED` per Issue #3 §3. The bounded peer topology and the existing role-level ACL are byte-identical. |
| `.pi/communication/runtime-policy.mjs` | Added `validateResearchBody` / `authorizeResearchDelegation` / `RESEARCH_MESSAGE_TYPES` imports. Extended `onToolCall` with `researchBodyGate` that runs after `authorizePeer` + `resolveTeamPeerRole` and before `sendWithPolicy`. Extended `onContext` with the same gate for inbound `RESEARCH_RESULT` / `RESEARCH_BLOCKED`. Refactored the inbound audit log to carry the gate's reason. | Runtime gate that enforces the schema before any research envelope reaches the transport. Existing tests unchanged because the gate returns `{ ok: true }` for non-research messages. |
| `.pi/agents/executor.md` | Step 4 enumerates the `RESEARCH_REQUEST` body schema fields and the validator function names; step 6 enumerates the `RESEARCH_RESULT` body schema fields and the `RESEARCH_BLOCKED` `reason_code` enum. | Mirror the runtime gate in the role prompt so the Executor can compose a request that will pass validation on first send. |
| `.pi/agents/researcher.md` | Step 1 enumerates the pre-flight schema checks; step 5 enumerates the `RESEARCH_RESULT` body schema fields and the `RESEARCH_BLOCKED` body schema fields with the `reason_code` enum. | Mirror the runtime gate in the Researcher prompt so the Researcher can verify a request before any web-access tool call. |
| `.pi/skills/execute-delegated-task/SKILL.md` | Step 3 and step 5 mirror the same schema field lists as `.pi/agents/executor.md`. | Skills stay in sync with role prompts. |
| `.pi/skills/answer-research-question/SKILL.md` | Steps 1, 8, 9 mirror the same schema field lists, the `reason_code` enum, and the pre-flight rule. | Skills stay in sync with role prompts. |
| `plans/ISSUE-003-decision.md` (new) | Decision, scope, mapping to C-002/C-004, constraints honored. | Lead-reproducible artifact for the decision. |
| `tests/communication-policy.test.mjs` | Added 21 new test cases: 12 validator/gate unit tests (Issue #3 policy constants, well-formed accept, under-specified, architectural, capability_blocked, cross-task, cross-delegation, malformed artifact_path, hash-in-slug, blocked_reason on result, next_decision_needed on blocked, unknown reason_code), 5 runtime-gate integration tests (P1 allowed, N1 cross-task refused, N2 bash refused, N3 architectural refused, N14 hash-in-slug refused), and 4 inbound/ACL tests (N12+N13 existing peer ACL, N15 cross-task inbound RESULT filtered, malformed inbound BLOCKED filtered, non-research pass-through). | Regression coverage for the Issue #3 allow scheme. |

Total diff: 6 production files (1 new policy module, 1 runtime policy extension, 2 role prompts, 2 skills) + 1 new plan + 1 extended test file. No changes to `scripts/pi-team.ps1`, the Blackboard plugin, the bounded peer topology, the role capability surface, the public CLI verbs, or the role memory files.

## Mapping to Issue #3 done criteria

| Criterion | Owner | Status | Evidence |
| --- | --- | --- | --- |
| **C-001** — Researcher produces a read-only allow-vs-prohibit survey with evidence-backed protocol recommendation, field constraints, authorization / scope / conflict rules, negative scenarios, and to-test items | researcher | MET (before this slice) | `research/ISSUE-003-bounded-research-protocol.md` |
| **C-002** — Executor implements a clear, executable Issue #3 protocol decision; updates necessary spec / role / communication implementation; adds regression coverage; Lead authority, task binding, artifact ownership, busy / out-of-scope / refusal semantics stay verifiable | executor | MET | `plans/ISSUE-003-decision.md`; `.pi/communication/policy.mjs` adds `RESEARCH_MESSAGE_TYPES` / `RESEARCH_BLOCK_REASON_CODES` / `RESEARCHER_CAPABILITIES` / `validateResearchBody` / `authorizeResearchDelegation`; `.pi/communication/runtime-policy.mjs` `onToolCall` + `onContext` extensions; `.pi/agents/{executor,researcher}.md` step updates; `.pi/skills/{execute-delegated-task,answer-research-question}/SKILL.md` mirror updates; new test cases in `tests/communication-policy.test.mjs` |
| **C-003** — Reviewer independently re-verifies | reviewer | PENDING | Handoff to paired Reviewer `pi-team--ISSUE-003--reviewer` |
| **C-004** — Lead-reproducible: full `tests/run-tests.ps1` and Issue #3 targeted tests both pass; positive and negative paths, task/scope binding, capability isolation, and existing lifecycle all pass; no cross-task or unauthorized delegation falsely reported as success | executor | MET | `tests/run-tests.ps1` → 63/63 pass (42 existing + 21 new Issue #3 cases); `reports/ISSUE-003-verification.md` is the dedicated Lead-reproducible artifact mapping C-002/C-004 to specific test cases |

## Cross-task impact

- `tests/run-tests.ps1` unchanged.
- `tests/team-contract.test.mjs` unchanged — the role markdown / skill / capability isolation contract is byte-equivalent (text-only updates do not change the parsed frontmatter assertions).
- `tests/blackboard.test.mjs` unchanged — Blackboard observability plane is not touched.
- Public CLI verbs (`pi-team.cmd publish / validate / start / sync / research / status / watch / resume / accept / close-incomplete / reconcile / reclaim / cleanup / setup / codex-setup / doctor`) unchanged.
- Bounded peer topology (`BOUNDED_PEERS`) unchanged.
- Role capability surface (`RESEARCHER_TOOLS`, `EXECUTOR_TOOLS`, `REVIEWER_TOOLS`) unchanged.
- Reviewer remains excluded from this protocol; no Researcher → Reviewer path is opened.
- Lead authority over task contract, scope, acceptance, reclamation is preserved.

## Validation performed

- `powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1` → **63/63 pass** (42 existing + 21 new Issue #3 cases). Duration ≈ 27 s.
- `git diff -- .pi/agents .pi/skills .pi/communication` shows only the 6 production files listed above.
- `git diff -- scripts/` is empty.
- `git diff -- plugins/agent-blackboard/` is empty.
- The role prompts and skills parse cleanly through the existing `parseFrontmatter` helper used by `tests/team-contract.test.mjs` (no frontmatter regressions; description / name / inheritSkills / skillPath / tools / subagentOnlyExtensions are byte-identical).
- Schema validator smoke test (manual, not committed) confirmed the validator handles all 9 reason_codes, the architectural-verb heuristic, the kebab-case slug check, the hash detection, and the cross-task / cross-delegation rejections.

## Remaining risks / open items (from Researcher §10)

- **Request budget per task** — recommended cap of 3 per Executor slice; needs Lead confirmation. Not encoded by this slice.
- **Artifact re-use across slices** — current rule "do not overwrite" is preserved; no change needed.
- **Researcher lifecycle in persistent pair** — on-demand Researcher continues; both shapes are schema-compatible.
- **Lead refusal mid-research** — already supported through `scope_change`; no change needed.
- **Cross-Executor collision** — impossible under current launcher; schema protects against concurrent overwrites.
- **Deep Research escape hatch** — explicit non-goal for Issue #3.
- **No-response detection (§5.5)** — relies on Blackboard polling; could be improved with a Lead-owned deadline tool. Out of scope for this slice.
- **Inbound `RESEARCH_RESULT` / `RESEARCH_BLOCKED` from an unauthorized sender** — already filtered by the existing `PolicyReceiver.receive` + sender-identity check before the new body gate runs; the new tests (N15 + malformed BLOCKED) confirm the body gate adds an additional filter layer without regressing the sender-identity filter.

## Handoff to paired Reviewer

- Paired Reviewer target (via `intercom list-cwd` in this worktree): `pi-team--ISSUE-003--reviewer`.
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-003`
- Branch: `pi-team/ISSUE-003-bounded-research`
- Implementation notes: `implementation_notes/ISSUE-003.md` (this file)
- Verification report: `reports/ISSUE-003-verification.md`
- Researcher's bounded proposal: `research/ISSUE-003-bounded-research-protocol.md`
- Decision plan: `plans/ISSUE-003-decision.md`
- Reviewer repro commands: `tests/run-tests.ps1` (63/63 pass). Reviewer can also run `git diff -- .pi/agents .pi/skills .pi/communication` and inspect the new test cases in `tests/communication-policy.test.mjs` (search for "Issue #3").

End of Executor notes.
