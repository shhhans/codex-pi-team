# ISSUE-003 — Decision: Allow same-task Executor → paired-Researcher bounded research, with normative schema

- Task ID: **ISSUE-003**
- Delegation: **EXECUTOR-ISSUE-003**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-003`
- Branch: `pi-team/ISSUE-003-bounded-research` (base ref `develop`)
- Researcher evidence: `research/ISSUE-003-bounded-research-protocol.md` (C-001 — `researcher`, completed before this Executor slice began)
- Frozen contract: `plans/ISSUE-003-task.md` (Lead-owned, unchanged)

## Decision (one paragraph)

Issue #3 is decided **allow**, with the field-level schema, busy / duplicate / out-of-scope / no-response rules, and Lead refusal path from `research/ISSUE-003-bounded-research-protocol.md` §2–§6 made normative and machine-checked at the runtime policy gate. The Lead-owned frozen contract remains the only source of truth for task scope, artifact ownership, and pair identity; Researcher remains on-demand / event-driven; Reviewer is not a participant. Lead retains three refusal levers — pre-send via `report_to_lead`, mid-flight via `scope_change`, and reclamation via `pi-team.cmd accept / close-incomplete`. The allow path preserves the active role prompts, the active skill files, the active bounded peer topology, the active capability surface, the public CLI, the Blackboard observability plane, and the historical `RESEARCH_RESULT` evidence recorded in `implementation_notes/ISSUE-001.md` lines 16–19.

## Why allow (not prohibit)

The Researcher survey (`research/ISSUE-003-bounded-research-protocol.md` §1) concludes that the active role prompts (`.pi/agents/executor.md` step 4, `.pi/agents/researcher.md` step 1/5) and the active skills (`execute-delegated-task/SKILL.md` steps 3–5, `answer-research-question/SKILL.md` steps 1, 8–9) already encode same-task Executor → paired-Researcher bounded research as the normative path. Prohibiting it would either silently down-grade the Researcher into a one-shot Lead-only consultation or force every implementation uncertainty to re-cross Lead, contradicting ADR 0002's "research findings and execution details travel directly within the pair; Lead arbitrates only when blocked". The Issue #1 implementation already exercised this path end-to-end with correlation_id `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee` (broker delivered 2026-08-29T13:04:40.230Z, body `Artifact ready. Confidence: high.`); regression would be a real loss.

The allow path is conditional on five guarantees that today live only as prose in the role prompts:

- **G1 — Pair identity**: the request must name the same `<task-id>` as the frozen contract, and `resolveTeamPeerRole(target, PI_TEAM_TASK_ID)` must resolve to `researcher`.
- **G2 — Scope binding**: `allowed_paths` must be a non-empty subset of the frozen contract's `in_scope`; `required_capabilities` must be a non-empty subset of `RESEARCHER_TOOLS`.
- **G3 — Artifact non-collision**: `artifact_path` must match `^research/<task-id>-<kebab-slug>\.md$`, the slug must be unique within the task, and the file must not already exist on disk.
- **G4 — One bounded question**: `objective` ≤ 240 chars, `decision_supported` non-empty, single question; multi-question or scope-shaping requests must be `RESEARCH_BLOCKED`.
- **G5 — Lead mirror**: every `RESEARCH_REQUEST` outbound, every `RESEARCH_RESULT` / `RESEARCH_BLOCKED` inbound, and every `RESEARCH_BLOCKED` outbound produce a `report_to_lead` event and the Blackboard state moves `working` ↔ `waiting`.

These are implementable without changing the public CLI, the Blackboard, the runtime policy's existing peer topology, or any role capability.

## What changes (the smallest coherent change)

### 1. `.pi/communication/policy.mjs` — schema constants and validator

- Add `RESEARCH_MESSAGE_TYPES = new Set(["RESEARCH_REQUEST", "RESEARCH_RESULT", "RESEARCH_BLOCKED"])`.
- Add `RESEARCH_BLOCK_REASON_CODES = new Set(["out_of_scope", "architectural", "under_specified", "capability_blocked", "in_flight_busy", "scope_change_invalidated", "deadline_unmet", "duplicate", "no_response_within_window"])`.
- Add `RESEARCHER_CAPABILITIES = new Set(["read", "grep", "find", "ls", "write", "web_search", "fetch_content", "get_search_content", "source_check", "intercom", "report_to_lead", "blackboard_update"])` (mirrors `tests/team-contract.test.mjs` `RESEARCHER_TOOLS`).
- Add `validateResearchBody(type, body)` that returns `{ ok: true }` or `{ ok: false, reason_code, detail }` for an Executor-originated request body, a Researcher-originated result body, and a Researcher-originated blocked body. Field-level checks per `research/ISSUE-003-bounded-research-protocol.md` §3.1, §3.2, §3.3.
- Add `authorizeResearchDelegation(body, taskId, allowedDelegations, allowedCapabilities)` that returns `{ ok: true }` or `{ ok: false, reason }`. Rejects when `body.task_id !== taskId`, `body.delegation_id` is not in `allowedDelegations`, `body.required_capabilities` is not a subset of `RESEARCHER_CAPABILITIES`, or `body.artifact_path` does not match the schema regex.
- The existing `BOUNDED_PEERS`, `makeEnvelope`, `parseEnvelope`, `resolveTeamPeerRole`, `PolicyReceiver`, `DedupStore`, `LeadAudit` are unchanged.

### 2. `.pi/communication/runtime-policy.mjs` — `onToolCall` extension

- After the existing `authorizePeer` and `resolveTeamPeerRole` checks, if `resolveTeamPeerRole` resolves to `"researcher"` and the envelope's body decodes to a `RESEARCH_REQUEST` shape, run `authorizeResearchDelegation` and `validateResearchBody("RESEARCH_REQUEST", body)`. Failure becomes `outcome: "refused", reason: "research-schema-invalid:<reason_code>:<detail>"` and the message never enters the transport.
- Mirror-image inbound check at `onContext`: if a `RESEARCH_RESULT` / `RESEARCH_BLOCKED` arrives, the existing `PolicyReceiver.receive` still gates by sender identity; this slice adds a body-level `validateResearchBody` only when the body type tag is present, so the existing tests continue to pass without modification.
- No new audit directory; reuse `appendPolicyAudit`.

### 3. `.pi/agents/executor.md` — step 4 schema

- Step 4 lists the `RESEARCH_REQUEST` body fields (`type`, `task_id`, `delegation_id`, `request_id`, `decision_supported`, `objective`, `allowed_paths`, `artifact_path`, `required_capabilities`, `frozen_contract_version`, optional `deadline_hint` and `context_refs`) and references `policy.mjs` `validateResearchBody` and `authorizeResearchDelegation` as the source-of-truth. Step 6 adds the `RESEARCH_RESULT` body fields and the `RESEARCH_BLOCKED` `reason_code` enum reference.

### 4. `.pi/agents/researcher.md` — step 5 schema

- Step 5 enumerates the `RESEARCH_RESULT` body fields and the `RESEARCH_BLOCKED` body fields including the `reason_code` enum, the `detail` cap, and the `next_decision_needed` rule. Step 1 explicitly calls out the pre-flight checks (`authorizeResearchDelegation` + `validateResearchBody`) that run before any web-access tool call.

### 5. `.pi/skills/execute-delegated-task/SKILL.md` and `.pi/skills/answer-research-question/SKILL.md`

- `execute-delegated-task` step 3 mirrors the same schema field list as `.pi/agents/executor.md` step 4 and adds the validation function names.
- `answer-research-question` steps 1, 8, 9 mirror the same schema field list, the `reason_code` enum, and the rule that pre-flight validation runs before any tool call.

### 6. `tests/communication-policy.test.mjs` and `tests/team-contract.test.mjs`

- New `tests/communication-policy.test.mjs` test cases for §8 P1, N1–N8, N11–N15 (positive, cross-task, capability, architectural, under-specified, in-flight busy, dedup, scope-change, lead-as-target, reviewer-as-researcher-target, hash-in-slug, cross-task RESULT). Each asserts both the audit row (`direction: "outbound", outcome: "refused|allowed"`) and the body-level validation reason when applicable.
- `tests/team-contract.test.mjs` is unchanged because the role markdown / skill / capability isolation contract is byte-equivalent (text-only updates do not change the parsed frontmatter assertions).

### 7. New `implementation_notes/ISSUE-003.md` and `reports/ISSUE-003-verification.md`

- `implementation_notes/ISSUE-003.md` records slice state, files changed, research request/result correlation, validation evidence, and remaining risks.
- `reports/ISSUE-003-verification.md` is the Lead-reproducible artifact mapping C-002 and C-004 to specific `tests/run-tests.ps1` invocations and to the new positive/negative test cases.

## Out of scope (deferred to future Lead-owned decisions)

The Researcher survey §10 lists six open items. None are closed by this Executor slice; they are recorded as Lead-owned follow-ups:

- **Request budget per task** (recommended cap: 3 per Executor slice) — needs Lead confirmation. Not encoded.
- **Artifact re-use across slices** — current rule is "do not overwrite"; aligned with existing rules, no change needed.
- **Researcher lifecycle in persistent pair** — on-demand Researcher continues; both shapes remain schema-compatible.
- **Lead refusal mid-research** — already supported through `scope_change`; no change needed.
- **Cross-Executor collision** — impossible under current launcher; schema protects against concurrent overwrites.
- **Deep Research escape hatch** — explicit non-goal for Issue #3.

## Mapping to Issue #3 done criteria

| Criterion | Owner | Status (this slice) | Evidence |
| --- | --- | --- | --- |
| **C-001** — Researcher read-only survey with allow/prohibit comparison, schema, conflict, busy, Lead refusal, scenarios | researcher | MET (this slice begins after C-001) | `research/ISSUE-003-bounded-research-protocol.md` (~60 KB; 547 numbered lines covering allow/prohibit, schema, busy, conflict, scope-change, Lead refusal, P1–P3 / N1–N15 / C1–C8) |
| **C-002** — Executor implements a clear, executable Issue #3 protocol decision; updates necessary spec/role/communication implementation; adds regression coverage; Lead authority, task binding, artifact ownership, busy / out-of-scope / refusal semantics stay verifiable | executor | MET | `plans/ISSUE-003-decision.md` (this file); `.pi/communication/policy.mjs` adds `RESEARCH_MESSAGE_TYPES`, `RESEARCH_BLOCK_REASON_CODES`, `RESEARCHER_CAPABILITIES`, `validateResearchBody`, `authorizeResearchDelegation`; `.pi/communication/runtime-policy.mjs` `onToolCall` extension; `.pi/agents/{executor,researcher}.md` step updates; `.pi/skills/{execute-delegated-task,answer-research-question}/SKILL.md` mirror updates; new test cases in `tests/communication-policy.test.mjs` |
| **C-003** — Reviewer independently re-verifies | reviewer | PENDING | Handoff to paired Reviewer `pi-team--ISSUE-003--reviewer` |
| **C-004** — Lead-reproducible: full `tests/run-tests.ps1` and Issue #3 targeted tests both pass; positive and negative paths, task/scope binding, capability isolation, and existing lifecycle all pass; no cross-task or unauthorized delegation falsely reported as success | executor | MET | `reports/ISSUE-003-verification.md` is the dedicated Lead-reproducible artifact; `tests/run-tests.ps1` baseline + new `tests/communication-policy.test.mjs` Issue #3 cases all pass |

## Constraints honored

- No `web_search`, no `bash` outside the worktree, no production-code edits outside the assigned worktree.
- Public CLI verbs (`pi-team.cmd publish / validate / start / sync / research / status / watch / resume / accept / close-incomplete / reconcile / reclaim / cleanup / setup / codex-setup / doctor`) unchanged.
- Bounded peer topology (`BOUNDED_PEERS`) unchanged; only the body-level schema is added.
- Role capability surface (`RESEARCHER_TOOLS`, `EXECUTOR_TOOLS`, `REVIEWER_TOOLS`) unchanged.
- No new persistent role memory, no new audit directory, no new transport primitive.
- Reviewer remains excluded from this protocol; no Researcher → Reviewer path is opened.
- Lead authority over task contract, scope, acceptance, reclamation is preserved.

## Decision owner and acceptance path

This decision is submitted to the paired Reviewer for C-003 verification, then to Lead for C-004 reproduction and acceptance. The Lead owns the final accept/reject and the project snapshot update (no architecture change is implied — the bounded peer topology is unchanged — so `architect.md` does not need editing; `goal.md` does not need editing because done criteria are unchanged; `project_state.md` does not need editing because no launcher, lifecycle, integration, repository-workflow, or closure surface changed).
