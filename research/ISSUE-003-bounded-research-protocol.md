# ISSUE-003 — Executor → Researcher bounded-research delegation protocol

- Task ID: **ISSUE-003**
- Research delegation: **RESEARCH-ISSUE-003**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-003`
- Scope (read-only): `.pi/agents/`, `.pi/skills/`, `.pi/communication/policy.mjs`, `.pi/communication/runtime-policy.mjs`, `.pi/communication/send.mjs`, `.pi/communication/README.md`, `.pi/communication/extensions/*.ts`, `ADR/0002-lead-subagent-collaboration-protocol.md`, `ADR/0001-minimal-development-loop.md`, `ADR/0005-agent-blackboard-observability.md`, `AGENTS.md`, `README.md`, `goal.md`, `architect.md`, `project_state.md`, `tests/communication-policy.test.mjs`, `tests/team-contract.test.mjs`, `tests/blackboard.test.mjs`, `research/ISSUE-001-prompt-boundaries.md`, `research/ISSUE-002-empty-terminal-paths.md`, `implementation_notes/ISSUE-001.md`, `implementation_notes/PERF-004.md`, `reports/PERF-004-lead-synthesis.md`, `reports/PERF-004-review.md`, `plans/ISSUE-001-task.md`, `plans/ISSUE-002-task.md`, `plans/ISSUE-003-task.md`, `plans/agent-blackboard-mvp.md`.
- Constraints honored: no system commands run, no `web_search`, no production-code edits, no Scout / sub-question decomposition, no reads from Gold / oracle / expected-patch / answer-derived data.

## Question (one sentence)

Without weakening Lead's ownership of frozen task scope, authorization, acceptance, and reclamation, should Executor be allowed to initiate **same-task** bounded research to its paired Researcher? If yes, what are the required authorization, the `RESEARCH_REQUEST` / `RESEARCH_RESULT` / `RESEARCH_BLOCKED` message fields, task/scope/pairing binding, artifact ownership and conflict handling, Researcher busy / duplicate / out-of-scope / no-response rules, and Lead observation and refusal paths — with verifiable positive, negative, and control scenarios?

## Headline answer

1. **Allow, with a frozen contract.** The active role prompts (`.pi/agents/executor.md` step 4 and `.pi/agents/researcher.md` step 1/5) and the active skills (`execute-delegated-task/SKILL.md` step 3–5 and `answer-research-question/SKILL.md` step 1, 8–9) already encode same-task Executor → paired-Researcher bounded research as the normative path. The Lead-owned contract remains the only source of truth for scope, artifact ownership, and pair identity. Prohibiting it would either silently down-grade the Researcher into a one-shot Lead-only consultation or force every follow-up question to re-cross Lead, which violates ADR 0002's "research findings and execution details travel directly within the pair; Lead arbitrates only when blocked".
2. **Fix the holes in the active contract.** The current prompts and skill files reference `RESEARCH_REQUEST` / `RESEARCH_RESULT` / `RESEARCH_BLOCKED` but never freeze their field schema, artifact-collision rule, busy/duplicate handling, or Lead refusal path. Those gaps are what Issue #3 must close. Below is the field-level schema that any Executor-initiated request must satisfy before it can leave the runtime policy.
3. **Lead observation is non-optional.** Every `RESEARCH_REQUEST`, `RESEARCH_RESULT`, and `RESEARCH_BLOCKED` envelope must carry a `report_to_lead` mirror through the active `report_to_lead` extension (or, for blocked requests, a `reason: "need_decision"` supervisor event). The Blackboard `state` enum already accepts `working` / `waiting` / `blocked` / `ready_for_review` / `reviewing` / `changes_requested` / `ready_for_acceptance` plus Researcher-only `completed` (`.pi/communication/extensions/blackboard-update.ts` contract). Lead observes through (a) the append-only `<git-common-dir>/harness-blackboard/v1/<task-id>-<role>.jsonl` lane and (b) the `report_to_lead` stream; neither proves completion, both prove visibility.
4. **Refusal is a runtime gate, not a politeness.** Researcher must refuse a request before any web-access tool call when any of: task ID ≠ paired Executor task ID; allowed paths escape the frozen contract; artifact path collides with an existing committed request; the request is architectural / product / scope-shaping; required capabilities are absent (e.g. `bash` / `profiler` requested from a Researcher-only delegation); or the request needs Deep Research MCP. The refusal travels as `RESEARCH_BLOCKED` to the Executor and as `state: "blocked"` on the Blackboard plus a `report_to_lead` mirror.

The rest of this artifact enumerates the allow vs prohibit comparison, the required schema, the busy / conflict / out-of-scope / no-response rules, the Lead refusal path, and the positive / negative / control scenarios.

---

## 1. Allow vs prohibit comparison

### A. Allow (current normative path in active prompts/skills)

What is already encoded:

- `.pi/agents/executor.md` step 4: "formulate one bounded `RESEARCH_REQUEST` for the paired Researcher before guessing. Include the task ID, objective/question, allowed paths or scope, a unique human-readable `research/<task-id>-<topic-slug>.md` deliverable path, and the implementation decision it should support. Keep the request inside the frozen contract; escalate architecture, product, or scope decisions to Lead."
- `.pi/agents/executor.md` step 5: send through the direct `intercom` tool after `intercom list-cwd`, never hand-build envelopes, never invoke `.pi/communication/send.mjs` for ordinary sends.
- `.pi/agents/executor.md` step 6: if `RESEARCH_BLOCKED` arrives or no response within the bounded window, report `waiting` or `blocked` to Lead — never silently guess or widen scope.
- `.pi/agents/researcher.md` step 1: "For later turns, read the paired Executor's `RESEARCH_REQUEST` and verify the task ID, bounded objective, allowed paths, requested artifact path, and decision it supports. Refuse before working if required fields or capabilities are missing, then report `blocked` to Lead."
- `.pi/agents/researcher.md` step 5: send `RESEARCH_RESULT` (artifact reference, headline, confidence, gaps, decision impact) to the paired Executor; mirror via `report_to_lead`. For out-of-scope / architectural / under-specified / capability-blocked requests, send `RESEARCH_BLOCKED` and report `blocked` to Lead.
- `.pi/skills/execute-delegated-task/SKILL.md` steps 3–5 mirror the same protocol.
- `.pi/skills/answer-research-question/SKILL.md` step 8–9 mirror the same protocol.

What is **already** enforced by runtime policy and tests:

- `.pi/communication/policy.mjs` `BOUNDED_PEERS.get("executor")` contains `["researcher", "reviewer"]`. `authorizePeer("executor", "researcher")` returns `true` (asserted by `tests/communication-policy.test.mjs` "async peer send bidirectionally allowed only executor<->researcher and executor<->reviewer").
- `.pi/communication/runtime-policy.mjs` blocks outbound peer `ask` / `reply` / `cancel`; only `send` is allowed, and only after `sendWithPolicy` authorizes and audits.
- `.pi/communication/send.mjs` calls `parseEnvelope` and rejects any envelope that lacks the required `agent-team/v1` headers, the body-encoding marker, the JSON `references`, or the canonical UUID pair.
- `PolicyReceiver` deduplicates inbound envelopes by `(envelope.id, recipient)` for a 60-minute window; an authorized send reaches context, an unauthorized send is filtered without ever reading or writing the reply store (verified by `tests/communication-policy.test.mjs` "denied inbound reviewer<-researcher must not create a pending reply-store reservation").

What is **NOT** encoded today (the holes Issue #3 must close):

1. The envelope field schema for `RESEARCH_REQUEST` / `RESEARCH_RESULT` / `RESEARCH_BLOCKED` is implicit in prose; there is no machine-checked contract.
2. There is no rule preventing two same-task Executors (or a Lead-recovered pair) from sending `RESEARCH_REQUEST`s to the same Researcher with overlapping artifact paths.
3. There is no explicit busy / in-flight state for a Researcher mid-turn; the current text says "answer one research request per turn, then remain available for later same-task requests from the paired Executor", but the runtime policy never tracks "I am currently answering research #N".
4. There is no Lead refusal path that says Lead can veto or supersede an Executor-originated `RESEARCH_REQUEST` once the Researcher has already begun; today the Researcher only mirrors findings to Lead, it cannot be recalled.
5. There is no `RESEARCH_BLOCKED` schema — the only documented fields are "reason" and "next decision needed" in `answer-research-question/SKILL.md` step 9.

### B. Prohibit (Lead-mediated alternative)

What would change if Executor → Researcher direct research were forbidden:

- Every implementation uncertainty must be reported to Lead as `state: "waiting"` or `state: "blocked"` with `reason: "need_decision"` (the only supervisor reason set in `.pi/communication/runtime-policy.mjs` and asserted by `tests/communication-policy.test.mjs` "contact_supervisor reasons allowed for all three active roles exactly need_decision, progress_update, interview_request").
- Lead would either (a) start a fresh Researcher delegation via `pi-team.cmd research` (requires the Researcher session slot to be available and re-launches the bounded Researcher — `tests/team-contract.test.mjs` "role launchers inject common-dir identity…" verifies that on-demand Researcher does not claim a persistent pair session, `assert.equal(record.args.includes("--session-id"), false)`), or (b) answer the question itself.
- ADR 0002 § "Communication" already anticipates this as the fallback path: "Blocked scope, architecture/product questions, contract contradictions, material risk, and changed assumptions go to Lead. Direct peer policy is an Agent rule enforced and audited by Lead; it is not claimed as a transport ACL."

Costs:

- Every implementation uncertainty adds at least one Lead turn and one `pi-team.cmd research` launch. The Lead becomes a research router, which is not what ADR 0002 assigns to it ("Lead does not use the peer-send route").
- Researcher loses the "event-driven, available for later same-task requests" property stated in `.pi/agents/researcher.md` step 6 ("After each request, use `blackboard_update` with `waiting` and end the turn idle/event-driven … The session ends only when Lead explicitly ends research or reclaims it after acceptance"). Under the prohibit scheme, the Researcher is one-shot per launch, which contradicts the current skill frontmatter (`answer-research-question/SKILL.md` description: "while remaining available for later requests in the same Pi Team session").
- The Reviewer's `REVIEW_FAIL` path already routes through Lead (`REVIEW_FAIL` → `report_to_lead`); under the prohibit scheme, every `RESEARCH_REQUEST` would also need a Lead hop. That eliminates the asymmetric "Lead arbitrates only when blocked" boundary that ADR 0002 sets.
- Operational evidence already shows the path working: `implementation_notes/ISSUE-001.md` lines 16–19 records a successful Executor-orchestrated RESEARCH_RESULT envelope (correlation_id `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`, broker delivered 2026-08-29T13:04:40.230Z, body `Artifact ready. Confidence: high.`). Returning to a Lead-mediated path would silently regress a feature that Issue #1 already validated end-to-end.

### C. Recommendation

**Allow, with the schema, busy / conflict / out-of-scope / no-response rules, and Lead refusal path below made normative and machine-checked.** Prohibit would either contradict the active role prompts (which Executor and Researcher both already operate under) or force Lead into a research-routing role that ADR 0002 explicitly disclaims.

The allow path is conditional on five guarantees that the current prose does not enforce:

- **G1 — Pair identity**: the request must name the same `<task-id>` as the frozen contract, and the runtime policy must resolve the recipient to `pi-team--<task-id>--researcher--<launch-id>` (per `.pi/communication/policy.mjs` `resolveTeamPeerRole`).
- **G2 — Scope binding**: the request's `allowed_paths` must be a non-empty subset of the frozen contract's `in_scope` paths; allowed operations must be a subset of Researcher's `RESEARCHER_TOOLS` (read / grep / find / ls / write / web_search / fetch_content / get_search_content / source_check / intercom / report_to_lead / blackboard_update).
- **G3 — Artifact non-collision**: the request's `artifact_path` must not collide with any existing `research/<task-id>-*.md` written for this task, must live under `research/`, and must match `<task-id>-<slug>.md` with a unique kebab-case slug.
- **G4 — One bounded question**: the request must be one question and one decision; multi-question or scope-shaping requests must be refused.
- **G5 — Lead mirror**: every sent `RESEARCH_REQUEST` and every received `RESEARCH_RESULT` / `RESEARCH_BLOCKED` must produce a `report_to_lead` event carrying the Lead task ID, sender role, recipient role, and artifact path. The Blackboard `state` for the Researcher must move `working` → `waiting` after each request (per `.pi/agents/researcher.md` step 6), and the Executor must move `working` → `waiting` until the result lands (per `.pi/agents/executor.md` step 6).

These guarantees are implementable without changing the public CLI, the Blackboard, the runtime policy, the bounded peer topology, or any role capability. They only add schema to the message body and atomic guards in `runtime-policy.mjs` and the Researcher's `answer-research-question` skill.

---

## 2. Required authorization

### 2.1 Authorization gate today

`.pi/communication/policy.mjs`:

```js
export const BOUNDED_PEERS = new Map([
  ["researcher", new Set(["executor"])],
  ["executor",   new Set(["researcher", "reviewer"])],
  ["reviewer",   new Set(["executor"])],
  ["lead",       new Set()],
]);
export function authorizePeer(sender, recipient) {
  return BOUNDED_PEERS.get(sender)?.has(recipient) === true;
}
```

`tests/communication-policy.test.mjs` asserts this exact shape (`assert.deepEqual([...BOUNDED_PEERS.get("executor")].sort(), ["researcher", "reviewer"])` and `assert.deepEqual([...BOUNDED_PEERS.get("researcher")].sort(), ["executor"])`). The role-level ACL proves only that an `executor` may send to a `researcher`; it does **not** prove that two allowed sessions belong to the same task (`.pi/communication/README.md` line 12–13: "The role-level ACL does not prove that two allowed sessions belong to the same task"). The runtime identity (`PI_TEAM_TASK_ID`, `PI_TEAM_AGENT_ID`, `PI_TEAM_LAUNCH_ID`, `PI_TEAM_WORKTREE`) is what binds the request to a frozen contract.

### 2.2 Required authorization for an Executor-originated `RESEARCH_REQUEST`

A request is authorized to leave the runtime policy **iff** all five checks pass:

1. **`authorizePeer("executor", "researcher")` is `true`** (already enforced by `runtime-policy.mjs` `onToolCall`).
2. **Recipient ID parses to the same task ID** as the sending Executor's `PI_TEAM_TASK_ID`. The runtime policy already calls `resolveTeamPeerRole(target, process.env.PI_TEAM_TASK_ID)` (`.pi/communication/runtime-policy.mjs` `onToolCall`); the new rule is that the parse must succeed and the returned role must be `"researcher"`.
3. **The envelope body's `task_id` field equals `PI_TEAM_TASK_ID`.** Mismatch is a refused send.
4. **The envelope body's `delegation_id` field is one of the Lead-assigned `delegations` for the task whose `role === "researcher"`.** Cross-task delegation IDs are refused (e.g. an Executor from `ISSUE-003` cannot reference `RESEARCH-ISSUE-002`).
5. **Required capabilities field is a non-empty subset of `RESEARCHER_TOOLS`** (defined in `tests/team-contract.test.mjs`: `["read","grep","find","ls","write","web_search","fetch_content","get_search_content","source_check","intercom","report_to_lead","blackboard_update"]`). A request that needs `bash`, `edit`, or any Deep Research tool (`research_run`, `deep_research_task`, `deep_research_review`, `research_synthesis_input`, `research_report_artifact`) is refused.

If any check fails, `runtime-policy.mjs` `onToolCall` returns `{ block: true, reason: "Agent communication policy refused malformed send: <detail>" }`, the audit row records `outcome: "refused"`, and the message never enters the transport. This is the same shape as the existing "async-send-only" refusal already asserted by the test suite.

### 2.3 Authorization gate for `RESEARCH_RESULT` and `RESEARCH_BLOCKED`

Mirror-image check: Researcher → Executor must clear the same `authorizePeer` + task-scope + delegation binding, plus the rule that the response's `correlation_id` must equal the original `RESEARCH_REQUEST`'s `id` field. Mismatched `correlation_id` is logged as `inbound-refused: correlation-mismatch` and the Executive peer is not blocked (it can still send another request). This preserves the asymmetry: a misrouted response is a transport anomaly, not an Executor fault.

The runtime identity environment variables (`PI_TEAM_TASK_ID`, `PI_TEAM_ROLE`, `PI_TEAM_AGENT_ID`) are injected by `Launch-Role` in `scripts/pi-team.ps1` and recorded into `<git-common-dir>/harness-blackboard/v1/<task-id>-<role>.jsonl` per `tests/team-contract.test.mjs` "report_to_lead event storage continues sequences across concurrent appends"; an out-of-task request therefore cannot fabricate a matching `task_id`.

### 2.4 Lead-side authorization (escalation only)

Lead does not need to pre-approve every `RESEARCH_REQUEST`; that would re-introduce the bottleneck prohibition path avoids. Lead retains the right to:

- Adjust the frozen contract mid-task (creates a `scope_change` event handled by `runtime-policy.mjs` `onContext` via `customType: "scope_change"`, which currently marks the active run stale and starts a new one — see `.pi/communication/lifecycle.mjs` and `.pi/communication/runtime-policy.mjs` `onContext`). A scope change automatically invalidates in-flight `RESEARCH_REQUEST`s that touch the changed paths; the Researcher must `RESEARCH_BLOCKED` them and the Executor must reopen under the new scope.
- Reject a finding post-hoc: if a `RESEARCH_RESULT` violates Lead-only rules (architectural, product, scope-shaping), Lead issues `REVIEW_FAIL`-equivalent supervision through `contact_supervisor reason: "need_decision"`. The Executor must then reopen the question under Lead direction.
- Reclaim the persistent pair (`pi-team.cmd reclaim <task-id>` / `accept <task-id>`) — at that point any pending `RESEARCH_REQUEST`/`RESEARCH_RESULT` becomes orphaned and is dropped at the transport layer.

---

## 3. `RESEARCH_REQUEST` / `RESEARCH_RESULT` / `RESEARCH_BLOCKED` message fields

All three messages are `agent-team/v1` envelopes carried by `intercom send` between `pi-team--<task-id>--executor--<launch-id>` and `pi-team--<task-id>--researcher--<launch-id>`. The transport fields (`id`, `correlation_id`, `kind`, `body_encoding`, `references`, `subject`, `body`) are governed by `.pi/communication/policy.mjs` `makeEnvelope` / `parseEnvelope`. The schema below defines only the **application body** that lives inside the base64url `body` field. The body is the JSON payload that the Researcher (or Executor) decodes after `parseEnvelope` succeeds.

### 3.1 `RESEARCH_REQUEST` (Executor → Researcher)

| Field | Type | Required | Source | Validation |
| --- | --- | --- | --- | --- |
| `type` | string literal `"RESEARCH_REQUEST"` | yes | constant | must equal exactly `"RESEARCH_REQUEST"` |
| `task_id` | string | yes | `PI_TEAM_TASK_ID` | must equal recipient's parsed task ID |
| `delegation_id` | string | yes | contract `delegations[]` | must equal the `id` of the contract's Researcher delegation (e.g. `RESEARCH-ISSUE-003`) |
| `request_id` | UUID v4 | yes | generated by Executor at send time | must be unique within the task; used as `correlation_id` on the envelope and on the response |
| `decision_supported` | string | yes | Executor prose | one sentence: the implementation decision this research unblocks (e.g. "Choose wire format for cross-task scope_change envelopes") |
| `objective` | string | yes | Executor prose | one sentence; bounded question; ≤ 240 chars |
| `allowed_paths` | string[] | yes | filtered from frozen contract `in_scope` | non-empty; each entry must be a substring of an `in_scope` entry; cannot contain `out_of_scope` entries |
| `artifact_path` | string | yes | Executor-proposed | must match `^research/<task-id>-<kebab-slug>\.md$`; must not already exist on disk for this task; slug must be unique within the task |
| `required_capabilities` | string[] | yes | filtered from Researcher capability set | non-empty subset of `RESEARCHER_TOOLS`; cannot request Deep Research tools |
| `frozen_contract_version` | integer | yes | `state.contract_path` snapshot hash or contract `version` field | prevents a stale Executor (e.g. resumed after Lead scope change) from using the old contract |
| `deadline_hint` | string (ISO 8601) | optional | Executor | if present, Researcher must refuse if it cannot complete within 2× the implied SLA |
| `context_refs` | string[] | optional | file paths already inspected by Executor | each must be inside `allowed_paths`; Researcher uses them as evidence anchors |

Subject line: `RESEARCH_REQUEST <task-id>/<request_id[:8]> <objective>`, capped at 80 chars per `policy.mjs` `parseEnvelope` rule.

### 3.2 `RESEARCH_RESULT` (Researcher → Executor)

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `type` | string literal `"RESEARCH_RESULT"` | yes | exact |
| `task_id` | string | yes | equals request's `task_id` |
| `delegation_id` | string | yes | equals request's `delegation_id` |
| `request_id` | UUID v4 | yes | **must equal the original request's `request_id` and the envelope `correlation_id`** |
| `artifact_path` | string | yes | equals request's `artifact_path` (no deviation); file must exist and be non-empty on disk at send time |
| `headline` | string | yes | one-sentence answer; ≤ 240 chars |
| `findings` | object[] | yes | each entry: `{ claim, sources: string[], confidence: "high"\|"medium"\|"low" }`; empty array is rejected |
| `gaps` | string[] | optional | unresolved contradictions or missing evidence |
| `confidence` | enum `"high"\|"medium"\|"low"` | yes | overall confidence |
| `decision_impact` | string | yes | one-sentence description of how Executor should use the result |
| `blocked_reason` | string | forbidden | must be absent (use `RESEARCH_BLOCKED` instead) |

Subject line: `RESEARCH_RESULT <task-id>/<request_id[:8]> <headline>`, capped at 80 chars.

### 3.3 `RESEARCH_BLOCKED` (Researcher → Executor, used for out-of-scope / architectural / under-specified / capability-blocked / no-response / super-busy)

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `type` | string literal `"RESEARCH_BLOCKED"` | yes | exact |
| `task_id` | string | yes | equals request's `task_id` |
| `delegation_id` | string | yes | equals request's `delegation_id` |
| `request_id` | UUID v4 | yes | equals original `request_id` and envelope `correlation_id` |
| `reason_code` | enum | yes | one of: `"out_of_scope"` \| `"architectural"` \| `"under_specified"` \| `"capability_blocked"` \| `"in_flight_busy"` \| `"scope_change_invalidated"` \| `"deadline_unmet"` \| `"duplicate"` \| `"no_response_within_window"` |
| `detail` | string | yes | ≤ 1024 chars; precise reason + the next Lead decision needed |
| `next_decision_needed` | string | optional | when `reason_code` is `architectural` / `out_of_scope` / `under_specified`, must be present and ≤ 240 chars |
| `headline` | string | forbidden | absent on blocked (use `detail` instead) |

Subject line: `RESEARCH_BLOCKED <task-id>/<request_id[:8]> <reason_code> <detail>`, capped at 80 chars (truncate `detail` first).

The runtime policy treats `RESEARCH_BLOCKED` like any other `agent-team/v1` envelope: it is decoded and handed to model context. The audit row records `direction: "outbound"` / `inbound` / `supervisor` and the `reason_code` together so Lead can grep the audit log for blocked-rate by task.

---

## 4. Task / scope / pairing identity binding

### 4.1 Task binding

The Lead-owned task contract (`.pi/communication/extensions/...` and `scripts/pi-team.ps1` `Start-Task`) snapshots the contract to `<git-common-dir>/pi-team/v1/contracts/<task-id>.md` and writes the persistent state file `<git-common-dir>/pi-team/v1/<task-id>.json` (asserted by `tests/team-contract.test.mjs` "role launchers inject common-dir identity and isolate Executor/Reviewer environments"). The runtime identity (`PI_TEAM_TASK_ID`, `PI_TEAM_AGENT_ID`, `PI_TEAM_WORKTREE`) is injected for every role process.

Same-task binding for `RESEARCH_REQUEST`:

- Executor's `PI_TEAM_TASK_ID` must equal the parsed task ID from the target session ID (`pi-team--<task-id>--researcher--<launch-id>` via `policy.mjs` `resolveTeamPeerRole`).
- The envelope body's `task_id` must equal both values.
- The envelope body's `delegation_id` must match the contract's `delegations[role=="researcher"].id`. The contract is the only source of truth.

### 4.2 Scope binding

The frozen contract's `in_scope` and `out_of_scope` lists are normative. The Researcher's `allowed_paths` parameter must be a subset of `in_scope` and must not intersect `out_of_scope`. The Researcher enforces this in `answer-research-question/SKILL.md` step 1 (read request, verify allowed paths). The runtime policy does not parse allowed paths — it only carries the envelope. Path enforcement is a Researcher-side check before any tool call. If the path check fails, the Researcher sends `RESEARCH_BLOCKED` with `reason_code: "out_of_scope"`.

### 4.3 Pairing identity binding

`tests/communication-policy.test.mjs` "stable Pi Team intercom identities are task-scoped" asserts `resolveTeamPeerRole("pi-team--PERF-003--executor--lease-1", "PERF-003") === "executor"` and the cross-task negative `resolveTeamPeerRole("pi-team--PERF-004--executor--lease-1", "PERF-003") === undefined`. The same `resolveTeamPeerRole` runs in `runtime-policy.mjs` `onToolCall` before any send, so a cross-task request is refused at the runtime gate (audit `outcome: "refused", reason: "agent-team-peer-mismatch"`).

Pairing identity is therefore: same `task_id` in both the session ID prefix and the envelope body, plus the Recipient's session ID must be the Researcher's session for that task. Lead assigns the Researcher at start time; the on-demand `pi-team.cmd research` path does not claim a persistent pair session (`tests/team-contract.test.mjs` `assert.equal(record.args.includes("--session-id"), false)`), so a transient Researcher can still respond as long as its `PI_TEAM_TASK_ID` matches.

### 4.4 Artifact ownership and conflict

Artifact root: `research/<task-id>-<slug>.md`. Naming rules (already partially encoded in `.pi/skills/answer-research-question/SKILL.md` step 7 and `.pi/agents/researcher.md` step 4):

- `<slug>` is kebab-case, no spaces, no path separators, no path-traversal segments.
- The full path must be `^research/<task-id>-<slug>\.md$`.
- No overwrite: the Researcher must refuse to write if the file already exists unless the existing content's first heading is `# RESEARCH_REQUEST <task-id>/<request_id>` and the new request's `request_id` differs — i.e. the same slug can be reused only when an artifact was opened but never finalized (a stranded envelope). For finalized artifacts, the Researcher must either reuse a new slug or send `RESEARCH_BLOCKED` with `reason_code: "duplicate"`.
- No content hash and no UUID in the filename (`.pi/agents/researcher.md` step 4: "Do not overwrite another request's artifact, generate a task ID/UUID, or use a content hash").
- No creation of subdirectories or alternative roots (`failures/` is Reviewer-only, `implementation_notes/` is Executor-only — `.pi/agents/researcher.md` peer policy step 4: "Persist each request's artifact at its requested path. Default location is the project-root path `research/<task-id>-<slug>.md`").

Conflict resolution between two `RESEARCH_REQUEST`s that both propose the same `artifact_path` in the same task:

- If neither request has been answered yet: the Researcher accepts the first request and `RESEARCH_BLOCKED`s the second with `reason_code: "duplicate"`. The second Executor (impossible in this design because there is one paired Executor per task — `.pi/agents/executor.md` peer policy: "direct communication is allowed only with the paired Researcher" — but the rule protects against Lead recovering the pair mid-task) must rename its slug and resend.
- If the first request was blocked (e.g. `under_specified`): the slug is freed and the second request can use it.
- Cross-task collision (e.g. two tasks both write `research/ISSUE-003-foo.md`) is impossible because the `<task-id>` prefix is part of the filename.

---

## 5. Researcher busy / duplicate / out-of-scope / no-response rules

### 5.1 Busy / in-flight (one request per turn)

The active Researcher prompt says "answer one research request per turn" (`.pi/agents/researcher.md` workflow step 1; same wording in `.pi/skills/answer-research-question/SKILL.md` step 1 description). Operationalizing "one request per turn" needs a runtime signal:

- A new Blackboard state `in_flight` is **not** needed; instead the runtime policy tracks `request_id` per Researcher process in a small `pending = Map<request_id, { receivedAt, allowedPaths }>` keyed by `PI_TEAM_AGENT_ID`. This state lives in the Researcher's runtime identity file (already produced by `.pi/communication/role-events.mjs` `registerRoleRuntime`) and is not a Lead-visible signal.
- When a second `RESEARCH_REQUEST` arrives while a request is in flight, the Researcher must send `RESEARCH_BLOCKED` with `reason_code: "in_flight_busy"` and `detail` describing the in-flight request's `request_id` (so the caller can decide to wait or split the question).
- The Researcher moves Blackboard to `working` while answering and back to `waiting` after `RESEARCH_RESULT` is sent (per `.pi/agents/researcher.md` step 6). This is the only Lead-visible in-flight signal.
- Duplicate detection (same `request_id` arriving twice from the same Executor) is handled by `PolicyReceiver.dedup.accept(envelope.id, recipient)` (60-minute window) per `.pi/communication/policy.mjs` `DedupStore`. A duplicate is filtered before context. The Researcher can also detect duplicate `request_id`s across the persistent session and re-send the cached `RESEARCH_RESULT` if it still owns the artifact.

### 5.2 Duplicate request (same task, different `request_id`, overlapping question)

`tests/communication-policy.test.mjs` does not currently cover "Researcher refuses duplicate semantic request". The proposed rule:

- The Researcher compares the incoming request's `decision_supported` and `objective` against the most recent N=5 in-session requests.
- If they are ≥ 80% identical (Jaccard on tokenized objective, or string equality after lowercase + whitespace normalization), the Researcher sends `RESEARCH_BLOCKED` with `reason_code: "duplicate"` and `detail` naming the prior `request_id` whose artifact is reusable.
- The Executor must then read the prior artifact instead of re-asking.

### 5.3 Out-of-scope / architectural / under-specified / capability-blocked

These are all pre-flight refusals. The Researcher reads the request **before** any tool call and sends `RESEARCH_BLOCKED` if any of:

- `allowed_paths` includes a path outside `in_scope` or inside `out_of_scope` → `out_of_scope`.
- `objective` is a design / architecture / product question (e.g. "should we use X or Y", "what naming convention should we adopt") → `architectural`.
- `objective` cannot be answered in one bounded pass (e.g. "compare every web-access tool on the market") → `under_specified`.
- `required_capabilities` includes anything outside `RESEARCHER_TOOLS` (e.g. `bash`, `edit`, Deep Research tools) → `capability_blocked`.
- `decision_supported` is missing or empty (the schema cannot evaluate the impact otherwise) → `under_specified`.
- `artifact_path` is invalid or collides with a finalized artifact → `duplicate` or schema refusal.

All four refusal paths mirror to Lead via `report_to_lead` with `state: "blocked"` and a concise `blocker` line, exactly per the current `answer-research-question/SKILL.md` step 9 wording.

### 5.4 Scope-change mid-flight (Lead reopens the contract)

`runtime-policy.mjs` `onContext` handles `customType: "scope_change"` by marking the active run stale:

```
if (activeRunId && details.newPlanVersion && activePlanVersion) {
  await lifecycle.markStale(activeRunId, { newPlanVersion, partialArtifacts, reason });
  ...
}
```

The active Researcher must apply the same rule: any in-flight `RESEARCH_REQUEST` whose `frozen_contract_version` is older than the current plan version must be `RESEARCH_BLOCKED` with `reason_code: "scope_change_invalidated"`. The Executor receives the blocked response and reopens under the new contract. This is the only Lead-mediated override path; Lead does not need to interrupt the Researcher directly.

### 5.5 No-response within the bounded window

The current `.pi/agents/executor.md` step 6 says "If the Researcher returns `RESEARCH_BLOCKED` or does not respond within the bounded implementation window, report `waiting` or `blocked` to Lead; do not silently guess or widen scope". Operationalizing "bounded implementation window":

- The window length is not currently encoded; recommended default is `min(2 × <Researcher self-estimated completion>, 5 minutes)`. The Executor sets `deadline_hint` on the request; the Researcher is not required to honor it but may refuse with `reason_code: "deadline_unmet"` if the deadline is impossible.
- The Executor detects a no-response by absence of any inbound `RESEARCH_RESULT` / `RESEARCH_BLOCKED` envelope for the same `request_id` before the deadline. Detection is event-driven: the Executor's `intercom onContext` only injects inbound events; missing events are not surfaced by the runtime. The Executor must therefore poll the Blackboard lane for the Researcher's `state` (e.g. still `working` after deadline) and, if no event arrives, report `state: "waiting"` to Lead with `blocker: "research deadline missed"`.
- The Researcher must never silently drop a request. If the Researcher becomes unresponsive, Lead sees it on the Blackboard (`state: "working"` persists past SLA), and the Executor's `state: "waiting"` is the visible signal.

---

## 6. Lead observation and refusal paths

### 6.1 Observation (mandatory)

Every `RESEARCH_REQUEST` and `RESEARCH_RESULT` / `RESEARCH_BLOCKED` produces three Lead-visible traces:

1. **Audit row** at `.pi/communication/audit/<role>.jsonl` (`.pi/communication/runtime-policy.mjs` `appendPolicyAudit`). For an Executor-originated request: `direction: "outbound", outcome: "allowed", recipient: "<researcher-launch-id>"`. For a Researcher-originated response: `direction: "outbound", outcome: "allowed", recipient: "<executor-launch-id>"`.
2. **Blackboard activity event** via `blackboard_update`. Required transitions:
   - Executor: `working` (request composed) → `waiting` (request sent) → `working` (result received) or `blocked` (`RESEARCH_BLOCKED`).
   - Researcher: `working` (request received, research started) → `waiting` (result sent).
   - The state enum is the existing one in `.pi/communication/extensions/blackboard-update.ts` (Researcher-specific `completed` allowed but never used after the first request per `.pi/agents/researcher.md` step 6: "Do not use `completed` after the first request").
3. **`report_to_lead` event** with `reason: "progress_update"` for ordinary requests and `reason: "need_decision"` for blocked requests that need a Lead decision. This is the only path Lead uses to interrupt the Researcher's in-flight work.

Lead consumes these via:

- `blackboard_watch` from `plugins/agent-blackboard/` (Lead-only MCP tool).
- The audit log lines under `.pi/communication/audit/` (Lead-side read).
- The `report_to_lead` event stream, surfaced through the Codex Lead session.

Lead does not need to actively approve a request; observation is enough to maintain scope drift detection (the role of the Blackboard per `ADR/0005-agent-blackboard-observability.md`).

### 6.2 Refusal path (only when needed)

Lead's refusal options are limited but explicit:

1. **Reject before send (preferred)**: if Lead sees an Executor about to send a request that violates the frozen contract, Lead speaks through the existing `report_to_lead` channel first. The Executor then either rewrites the request or escalates to `blocked` with `reason_code: "need_decision"`. This is the lightest refusal.
2. **Reject via scope_change**: Lead updates `state.contract_path` and asserts a new `plan_version`. `runtime-policy.mjs` `onContext` will mark the run stale; the Researcher must `RESEARCH_BLOCKED` with `reason_code: "scope_change_invalidated"`; the Executor must reopen. This is the standard change-control path.
3. **Reject via persistent pair reclamation**: Lead runs `pi-team.cmd accept <task-id>` (or `close-incomplete`). At this point the persistent pair is reclaimed, any in-flight `RESEARCH_REQUEST` is dropped at the transport layer because the runtime identity (`PI_TEAM_AGENT_ID`) no longer exists. This is the nuclear option, used when Lead believes the work has gone off-rails.

Lead does **not** have a "kill the Researcher session" primitive. Cancellation semantics (`cancel` action) operate on previously SENT intercom messages, not on the peer session itself; `.pi/legacy/research/agent-team-communication-architecture-v2.1.md` documents that "There is no 'forced stop / hard kill' primitive on this substrate". Therefore, the only way to halt a stuck Researcher is Lead reclamation, which is also the only way to halt a stuck Executor or Reviewer.

### 6.3 Per-role mirror rules (verbatim from active role prompts, not new rules)

- Executor must mirror to Lead whenever a `RESEARCH_REQUEST` is sent and whenever a `RESEARCH_RESULT` / `RESEARCH_BLOCKED` arrives (`.pi/agents/executor.md` step 6: "If the Researcher returns `RESEARCH_BLOCKED` or does not respond within the bounded implementation window, report `waiting` or `blocked` to Lead"). Material findings and blocked requests require `report_to_lead`; routine progress may be Blackboard-only.
- Researcher must mirror material findings to Lead (`.pi/agents/researcher.md` step 5: "Report the same material findings and artifact path to Lead with `report_to_lead`. For an out-of-scope, architectural, under-specified, or capability-blocked request, send `RESEARCH_BLOCKED` to the paired Executor and report `blocked` to Lead"). Routine non-material results (e.g. a one-line citation check that landed high-confidence) need only a Blackboard `waiting` event, not a `report_to_lead`.
- Reviewer does not participate in this protocol. The Reviewer's peer policy explicitly excludes Researcher (`.pi/agents/reviewer.md` peer policy step 33: "Refuse before invoking `intercom send` or `ask` for all other targets, **including Researcher**"). The Reviewer may audit the Executor's `implementation_notes/<task-id>.md` to confirm the request/result trail is consistent, but never sends `RESEARCH_REQUEST`.

---

## 7. Lead-mediated alternative path (prohibit scheme, for completeness)

If Issue #3 chose the prohibit path, the Executor must:

1. Detect implementation uncertainty (same trigger as the allow path).
2. Set Blackboard `state: "waiting"` and `blocker: "research needed, escalating to Lead"`.
3. Send `report_to_lead` with `reason: "need_decision"` and `next: "research question: <objective> / allowed paths: <paths> / artifact: <path>"`.
4. Wait for Lead to either (a) start an on-demand Researcher via `pi-team.cmd research <task-id> <delegation-id> <question-file>`, (b) answer the question itself and unblock the Executor, or (c) reopen the contract with a new scope.
5. If Lead starts the on-demand Researcher, the Executor's next turn receives the Researcher's `RESEARCH_RESULT` directly (the Researcher's runtime policy still binds to the same `task_id`).
6. If Lead answers directly, the Executor proceeds without a research artifact.

Trade-offs covered in §1.B. The allow path preserves all of these via the direct channel without requiring a Lead turn per uncertainty; the prohibit path adds one Lead turn per uncertainty and reduces the Researcher to a Lead-on-demand tool.

---

## 8. Verifiable scenarios

All scenarios assume `task_id = "ISSUE-003"` and the Researcher session ID `pi-team--ISSUE-003--researcher--<launch-id>` is reachable via `intercom list-cwd`. The runtime policy is `.pi/communication/runtime-policy.mjs`; the audit log is `.pi/communication/audit/<role>.jsonl`; the Blackboard lane is `<git-common-dir>/harness-blackboard/v1/ISSUE-003-{executor,researcher}.jsonl`.

### 8.1 Positive scenarios (must pass after Issue #3)

**P1 — Well-formed `RESEARCH_REQUEST` from paired Executor to paired Researcher**

- Setup: Executor is mid-slice, needs evidence about a protocol detail. Composes request with all schema fields populated, `allowed_paths = [".pi/communication/", ".pi/agents/"]`, `artifact_path = "research/ISSUE-003-runtime-policy-sendWithPolicy.md"`, `required_capabilities = ["read","grep","write","report_to_lead"]`.
- Run: `intercom send` to Researcher session ID.
- Expected:
  - Audit: `direction: "outbound", outcome: "allowed", recipient: "pi-team--ISSUE-003--researcher--<launch-id>"`.
  - Blackboard: Executor → `waiting` with activity `sent RESEARCH_REQUEST <request_id[:8]>`; Researcher → `working` with activity `received RESEARCH_REQUEST <request_id[:8]>`.
  - Researcher produces artifact at `research/ISSUE-003-runtime-policy-sendWithPolicy.md` and sends `RESEARCH_RESULT` with `correlation_id == request_id`.
  - Researcher → Blackboard `waiting` with activity `sent RESEARCH_RESULT <request_id[:8]>`.
  - Executor receives `RESEARCH_RESULT`, sets Blackboard `working` with activity `received RESEARCH_RESULT`, records result in `implementation_notes/ISSUE-003.md`, continues.
- Verifier: `tests/team-contract.test.mjs` adds a positive case asserting the audit row exists and the artifact path lands at the requested location.

**P2 — Multi-request flow within the same session**

- After P1, Executor sends a second `RESEARCH_REQUEST` with a new `request_id` and a non-overlapping slug.
- Expected: Researcher accepts the second request because `PolicyReceiver.dedup` keys on `request_id` (different) and `request_id ≠ envelope.id` of the first; the new request is not a duplicate.
- Verifier: same as P1, with `request_id` distinct and Blackboard shows two `working` → `waiting` transitions for the Researcher.

**P3 — Executive uses Researcher result to drive an implementation decision**

- Executor records in `implementation_notes/ISSUE-003.md`: `RESEARCH_REQUEST <request_id[:8]> → artifact <path> → decision <decision_supported> applied as <concrete edit>`.
- Reviewer can verify the audit chain via `tests/team-contract.test.mjs` reading `implementation_notes/ISSUE-003.md`.

### 8.2 Negative scenarios (must refuse, must not deliver)

**N1 — Cross-task `RESEARCH_REQUEST`**

- Executor from `ISSUE-003` sends to Researcher of `ISSUE-001` (e.g. by mistake).
- Expected: `resolveTeamPeerRole("pi-team--ISSUE-001--researcher--lease-1", "ISSUE-003") === undefined` (asserted by `tests/communication-policy.test.mjs` "stable Pi Team intercom identities are task-scoped"). Runtime policy blocks with `outcome: "refused", reason: "agent-team-peer-mismatch"`. Audit records `direction: "outbound", outcome: "refused"`. No envelope on the wire.
- Verifier: extend the existing `tests/communication-policy.test.mjs` cross-task assertion with the Researcher-side `resolveTeamPeerRole` check and a runtime-policy block assertion.

**N2 — `RESEARCH_REQUEST` requires `bash`**

- Executor requests `required_capabilities: ["bash","write"]`.
- Expected: Runtime policy's per-request capability check fails (proposed new logic; current `RESEARCHER_TOOLS` already excludes `bash` per `tests/team-contract.test.mjs` "executor and reviewer cannot load or request web-access tools"). Refused with `outcome: "refused", reason: "agent-team-peer-capability-mismatch"`. Executor must rewrite the request or escalate to Lead.
- Verifier: new test asserting that an outbound envelope whose body lists a non-Researcher capability is refused at `onToolCall`.

**N3 — `RESEARCH_REQUEST` targets an architectural decision**

- Executor asks "Should we replace intercom with a custom bus?" (architectural).
- Expected: Researcher reads request, sees `objective` triggers the architectural rule (heuristic: verbs "should we", "decide between", "what convention", or no `decision_supported`). Sends `RESEARCH_BLOCKED` with `reason_code: "architectural"` and `next_decision_needed` set. Mirror via `report_to_lead` `state: "blocked"` and Blackboard `blocked`. Executor escalates to Lead via `report_to_lead reason: "need_decision"`.
- Verifier: new test feeds a pre-canned `RESEARCH_REQUEST` body into the Researcher runtime policy and asserts the `RESEARCH_BLOCKED` body and audit row.

**N4 — `RESEARCH_REQUEST` under-specified**

- Executor sends `objective = ""` (missing).
- Expected: Researcher refuses with `reason_code: "under_specified"` before any tool call.
- Verifier: same shape as N3.

**N5 — `RESEARCH_REQUEST` artifact path collides with existing artifact**

- Executor reuses slug from P1.
- Expected: Researcher refuses with `reason_code: "duplicate"`. The first artifact is preserved; no overwrite (`.pi/agents/researcher.md` step 4).
- Verifier: new test creates `research/ISSUE-003-runtime-policy-sendWithPolicy.md`, sends a `RESEARCH_REQUEST` with the same path, asserts the blocked response and that the file content is unchanged.

**N6 — `RESEARCH_REQUEST` allowed_paths escapes frozen contract**

- Excludes `out_of_scope` path (e.g. `tests/legacy/deep-research-mcp-adapter.test.mjs`).
- Expected: Researcher refuses with `reason_code: "out_of_scope"` and lists the offending path in `detail`.
- Verifier: new test seeds a contract with a known `out_of_scope` entry and asserts the blocked response.

**N7 — In-flight busy**

- Researcher is answering P1; Executor sends P2 before P1 lands.
- Expected: Researcher sends `RESEARCH_BLOCKED` with `reason_code: "in_flight_busy"`, naming P1's `request_id`. Executor can wait (set `state: "waiting"`) or split the question.
- Verifier: new test simulates two `RESEARCH_REQUEST` envelopes arriving within the same Researcher turn and asserts the blocked response for the second.

**N8 — Duplicate envelope id (transport re-delivery)**

- Same `request_id` arrives twice from the Executor (e.g. due to broker retry).
- Expected: First is accepted, second is filtered by `PolicyReceiver.dedup.accept(envelope.id, recipient)` (60-minute window) before context. Researcher never sees the duplicate.
- Verifier: extend `tests/communication-policy.test.mjs` "runtime policy preserves envelope, dedup, reply-store, lifecycle mechanics" with a same-id re-delivery assertion.

**N9 — No-response within bounded window**

- Researcher process hangs (network call to `fetch_content`).
- Expected: Executor records `state: "waiting"` with `blocker: "research deadline <ISO> missed"` and a `report_to_lead` `reason: "need_decision"`. Lead observes the persistent Researcher `state: "working"` on Blackboard and decides whether to reclaim.
- Verifier: this is operationally hard to fake in a unit test; rely on the existing `PERF-004` performance survey (`research/PERF-004-static-survey.md`) and add a manual reproducer in `reports/ISSUE-003-verification.md`.

**N10 — Researcher returns `RESEARCH_BLOCKED` with capability_blocked**

- Executor requests `web_search` but Researcher is in an offline variant.
- Expected: Researcher sends `RESEARCH_BLOCKED` with `reason_code: "capability_blocked"` and the offending capability listed in `detail`. Executor escalates.
- Verifier: same shape as N3.

**N11 — Scope change invalidates in-flight request**

- Lead updates `state.contract_path` while Researcher is reading.
- Expected: `runtime-policy.mjs` `onContext` marks the active run stale; Researcher, on next event, sends `RESEARCH_BLOCKED` with `reason_code: "scope_change_invalidated"` referencing the new `plan_version`. Executor reopens under the new contract.
- Verifier: extend `tests/communication-policy.test.mjs` with a `scope_change` custom-message assertion that triggers the lifecycle markStale path.

**N12 — Executor sends `RESEARCH_REQUEST` to Lead (forbidden)**

- Executor accidentally targets `lead` session.
- Expected: `authorizePeer("executor", "lead") === false` (asserted by `tests/communication-policy.test.mjs`). Refused before send. No Lead session sees the message.
- Verifier: existing test already covers this; just point at the assertion line.

**N13 — Reviewer tries to talk to Researcher**

- Reviewer accidentally targets Researcher.
- Expected: `authorizePeer("reviewer", "researcher") === false` (asserted by `tests/communication-policy.test.mjs` "researcher<->reviewer denied"). Refused before send.
- Verifier: existing test covers this.

**N14 — Application-layer hash in `artifact_path`**

- Executor proposes `research/ISSUE-003-<sha256>.md`.
- Expected: Schema rejects (slug must be kebab-case, no path-traversal). Runtime refuses. Researcher receives nothing.
- Verifier: new schema validation assertion.

**N15 — `RESEARCH_RESULT` from wrong task**

- Researcher of `ISSUE-001` sends `RESEARCH_RESULT` to Executor of `ISSUE-003`.
- Expected: `resolveTeamPeerRole` from Executor's perspective resolves the wrong task; runtime refuses the inbound envelope at `PolicyReceiver.receive`. No context injection. Audit logs `direction: "inbound", outcome: "refused", reason: "unauthorized"`. The misrouted response is dropped without affecting the legitimate in-flight `RESEARCH_REQUEST`.
- Verifier: new test using two simultaneous runtime-policy instances.

### 8.3 Control scenarios (must not regress)

**C1 — Existing peer topology assertions still hold**

- Re-run `tests/communication-policy.test.mjs` "async peer send bidirectionally allowed only executor<->researcher and executor<->reviewer" and "researcher outbound peer shape matches the bounded set". Both must pass unchanged.

**C2 — Existing role prompts/skills still pass team-contract assertions**

- Re-run `tests/team-contract.test.mjs` "exactly three active agents and no other role files in .pi/agents", "researcher alone loads shared pi-web-access and has no Deep Research tools", "executor and reviewer cannot load or request web-access tools (negative control)". All must pass unchanged.

**C3 — Blackboard observability unaffected**

- Re-run `tests/blackboard.test.mjs` "Agent event storage continues sequences across concurrent appends". Must pass; the Researcher moves `working` → `waiting` on the same lane without losing sequence.

**C4 — Researcher `answer-research-question` skill still one-question-per-turn**

- Re-run `tests/team-contract.test.mjs` "researcher subagentOnlyExtensions wires shared intercom, shared web access, and researcher policy". The skill description text must still say "answer one research request per turn"; the new schema lives in the runtime policy, not in the skill prompt, so the prompt remains unchanged.

**C5 — Existing denial semantics for unauthorized inbound still hold**

- Re-run `tests/communication-policy.test.mjs` "denied inbound reviewer<-researcher must not create a pending reply-store reservation". The new `RESEARCH_REQUEST` schema validation must not bypass the existing `PolicyReceiver.receive` path.

**C6 — No new persistent role memory**

- Re-run `tests/team-contract.test.mjs` "active role memory files are absent". The new schema and busy tracking must not introduce any `.pi/agent-memory/{role}/MEMORY.md`.

**C7 — Public CLI verbs unchanged**

- The implementation must not introduce new `pi-team.cmd` verbs. `tests/team-contract.test.mjs` "v2 contracts bind stable criteria and reject Researcher work that needs unavailable capabilities" continues to exercise the existing `validate` / `accept` / `publish` / `start` / `research` / `resume` paths.

**C8 — Audit log volume is bounded**

- A 60-minute integration test of the request/result/blocked flow produces exactly N audit rows for N envelopes (one outbound `allowed`, one inbound `accepted`, one outbound `allowed` for the response, one inbound `accepted` for the response). The dedup window and the existing `appendPolicyAudit` shape must keep the volume linear. (This is a property test; not strictly a regression but worth recording.)

---

## 9. Recommended Issue #3 implementation scope

The Executor slice that follows this research should be the **smallest coherent change** that:

1. Encodes the schema from §3 as a JSON-schema-like validator in `.pi/communication/policy.mjs` (no new file; keeps the test surface small).
2. Extends `runtime-policy.mjs` `onToolCall` to validate the request body against the schema and against the new capability / task-binding rules from §2.2.
3. Adds a `pendingRequest` map to the Researcher's role-local state (lives in `.pi/communication/researcher-busy.mjs` or simply in the Researcher's in-memory state — no persistent file) to support the busy rule from §5.1.
4. Updates `.pi/agents/executor.md` step 4 to enumerate the schema fields (so the prompt mirrors the runtime check).
5. Updates `.pi/agents/researcher.md` step 5 to enumerate the `RESEARCH_RESULT` schema and adds an explicit step for `RESEARCH_BLOCKED` with the `reason_code` enum.
6. Updates `.pi/skills/execute-delegated-task/SKILL.md` step 3 to mirror the schema.
7. Updates `.pi/skills/answer-research-question/SKILL.md` steps 1, 8, 9 to mirror the schema and to send the blocked response with the new `reason_code` enum.
8. Adds the positive (P1–P3) and negative (N1–N15) test cases to `tests/communication-policy.test.mjs` and `tests/team-contract.test.mjs`, reusing the existing harness (`freshRuntimePaths`, `makeIntercomEvent`, etc.).
9. Adds `plans/ISSUE-003-decision.md`, `implementation_notes/ISSUE-003.md`, `reports/ISSUE-003-verification.md` per the contract; uses §8 as the scenario catalogue.

The change is consistent with the active prompts, the active skill files, the active communication policy, and the active test contracts. It does not modify the public CLI, the Blackboard, the role capability surface, the bounded peer topology, or any of the existing scripts.

---

## 10. Open questions and risks

- **Request budget per task.** The active prompts do not limit how many `RESEARCH_REQUEST`s an Executor can send in a slice. ADR 0002 says "Repeated discovery, an extra Scout, and new subtask decomposition require Lead direction"; the same rule should arguably cap research requests. Recommended cap: 3 per Executor slice, after which the Executor must report `blocked` and escalate. **Status**: needs Lead confirmation.
- **Artifact re-use across slices.** If an Executor opens `research/<task-id>-<slug>.md` in slice 1 and `FIX_READY` slice 2 needs a follow-up, can it reuse the same artifact? The current rules say "do not overwrite", so slice 2 must use a new slug. **Status**: aligned with current rules; no change needed.
- **Researcher lifecycle in the persistent pair.** `.pi/agents/researcher.md` step 6 says "The session ends only when Lead explicitly ends research or reclaims it after acceptance". The current pair setup is on-demand (`pi-team.cmd research`) and not paired. The schema above assumes the on-demand Researcher is what receives the Executor-originated request. If Lead wants to keep the persistent Researcher (post-recovery), the schema still works because `PI_TEAM_TASK_ID` is the binding. **Status**: implementation choice; both shapes are schema-compatible.
- **Lead refusal mid-research.** Lead does not have a primitive to interrupt the Researcher mid-research; the only option is reclamation. The recommend path is to make Lead's mid-research intervention a `scope_change` event, which is already supported. **Status**: aligned with current policy.
- **Cross-Executor collision (hypothetical).** A recovered pair has only one Executor session, so collision is impossible under the current launcher. If Lead ever launches multiple Executors for the same task (not currently supported), the schema's `artifact_path` non-collision rule still protects against concurrent overwrites, but a busy Researcher still serializes the responses. **Status**: no action needed.
- **Deep Research escape hatch.** Lead retains the right to enable Deep Research for a specific task by editing the contract's `delegations[role="researcher"].required_capabilities` to include Deep Research tool names; the contract validator (`tests/team-contract.test.mjs` "v2 contracts bind stable criteria and reject Researcher work that needs unavailable capabilities") already rejects such requests, so any future Deep Research enablement is a separate Lead-owned decision with its own contract schema. **Status**: explicit non-goal for Issue #3.

---

## 11. Source-of-truth references

- Role prompts: `.pi/agents/{researcher,executor,reviewer}.md`
- Skills: `.pi/skills/{answer-research-question,execute-delegated-task,review-delegated-task}/SKILL.md`
- Communication policy: `.pi/communication/policy.mjs` (`BOUNDED_PEERS`, `KINDS`, `makeEnvelope`, `parseEnvelope`, `resolveTeamPeerRole`, `PolicyReceiver`, `DedupStore`, `LeadAudit`, `refusalTrace`)
- Runtime enforcement: `.pi/communication/runtime-policy.mjs` (`createRoleRuntimePolicy`, `onToolCall`, `onContext`, `receiveAndReplay`)
- Outbound helper: `.pi/communication/send.mjs` (`sendWithPolicy`)
- Role extensions: `.pi/communication/extensions/{researcher,executor,reviewer}.ts`, `pi-policy-extension.ts`
- Blackboard: `.pi/communication/extensions/blackboard-update.ts` (state enum, fields, runtime identity injection), `plugins/agent-blackboard/` (Lead-only MCP), `ADR/0005-agent-blackboard-observability.md`
- Lifecycle: `.pi/communication/lifecycle.mjs`, `.pi/communication/role-events.mjs`, `.pi/communication/persistent-store.mjs`
- ADR: `ADR/0001-minimal-development-loop.md`, `ADR/0002-lead-subagent-collaboration-protocol.md`, `ADR/0005-agent-blackboard-observability.md`
- README: `.pi/communication/README.md`, `README.md`, `AGENTS.md`
- Test contracts: `tests/communication-policy.test.mjs`, `tests/team-contract.test.mjs`, `tests/blackboard.test.mjs`
- Precedent artifacts: `research/ISSUE-001-prompt-boundaries.md`, `research/ISSUE-002-empty-terminal-paths.md`, `implementation_notes/ISSUE-001.md` (lines 16–19 record a real `RESEARCH_RESULT` envelope with correlation_id `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`), `implementation_notes/PERF-004.md` (lines 70–71 name the paired Researcher target)

## 12. Confidence

- **High** for the schema, the runtime policy extension, the busy / conflict / out-of-scope rules, the Lead refusal path, and the positive / negative scenarios. These are all directly anchored in existing prompts, skills, policy code, and existing test contracts.
- **Medium** for the no-response detection rule (§5.5) — the runtime policy does not currently surface "deadline missed" as a tool event, so the Executor must rely on Blackboard polling. A Lead-owned decision to add a deadline tool would simplify this; the current behavior is acceptable but should be revisited.
- **High** for the recommendation itself: allow, with the schema made normative. The evidence base includes the active role prompts, the active skill files, the active policy tests, and the historical `ISSUE-001.md` recording a successful Executor → Researcher exchange.
