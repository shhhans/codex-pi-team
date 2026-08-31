# ISSUE-011 — Hide intercom Base64 envelope from agent workflow and improve stale-session recovery

- Task ID: **ISSUE-011**
- Research delegation: **RESEARCH-ISSUE-011**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-011-intercom-envelope-recovery`
- Scope (read-only): `.pi/communication/{policy.mjs,send.mjs,runtime-policy.mjs,persistent-store.mjs,lifecycle.mjs,pi-policy-extension.ts,extensions/*,audit/*,README.md,canonical-plan.json}`, `.pi/agents/{researcher,executor,reviewer}.md`, `.pi/skills/{answer-research-question,execute-delegated-task,review-delegated-task}/SKILL.md`, `tests/{communication-policy,team-contract,blackboard}.test.mjs`, `tests/run-tests.ps1`, `ADR/0002-lead-subagent-collaboration-protocol.md`, `ADR/0005-agent-blackboard-observability.md`, `AGENTS.md`, `README.md`, `architect.md`, `project_state.md`, `plans/ISSUE-011-task.md`, `reports/ISSUE-001-review.md`, `reports/PERF-004-review.md`, `implementation_notes/{ISSUE-001,ISSUE-003}.md`, `.pi/decisions/2026-08-21-agent-team-communication-baseline.md`.
- Constraints honored: no system commands run, no `web_search`, no production-code edits, no Scout / sub-question decomposition, no reads from Gold / oracle / expected-patch / answer-derived data, no creation of helper scripts.

## Question (one sentence)

Without changing the `agent-team/v1` wire envelope or the bounded peer / task / scope / role ACL, how should the repo-local communication layer hide Base64 body encoding from the normal agent-facing send / log / rediscovery path and how should it let a same-task paired peer rediscover a stale session, and how do these compare to directly modifying or replacing the envelope?

## Headline answer

1. **Keep the wire envelope.** Approach A (keep `agent-team/v1` wire envelope; add structured send helpers and redacted audit fields; let same-task paired peers rediscover stale sessions) is the only path that satisfies Issue #11's `out_of_scope` clauses ("替换 agent-team/v1 wire envelope、取消 body encoding 校验或破坏现有消息兼容性"; "扩大 BOUNDED_PEERS、task/scope/role 授权、Lead 权限或 artifact 所有权"). Approach B (modify or replace the envelope) breaks every existing test in `tests/communication-policy.test.mjs` that asserts the wire shape and the canonical-base64url check, breaks ADR 0002 §"Allowed routes" because the bounded-peer ACL is bound to role names that survive only when the envelope's `references` and field set remain stable, and removes the audit-evidence path that Lead uses for retrospective verification.
2. **Base64 exposure is real but small.** The envelope body is `Buffer.from(body, "utf8").toString("base64url")` (`.pi/communication/policy.mjs:66`), the message field on `intercom({action:"send"})` carries the resulting text, and the agent's outbound send call is already mediated by `runtime-policy.mjs` `onToolCall` + `sendWithPolicy` (`policy.mjs` `parseEnvelope` is called twice — once in the runtime hook, once in `send.mjs`). The only places where a Base64 body has actually leaked into the agent workflow in prior slices are: (a) PERF-004's disclosure of a malformed hand-rolled `+` body during a `READY_FOR_REVIEW` send, and (b) ISSUE-001's `helper-encode.mjs` (956-byte untracked Node script under `.pi/skills/answer-research-question/` that emits an `agent-team/v1` envelope). Both are pre-Issue-3 evidence that Base64 has *tempted* agents to hand-encode; Issue #3 narrowed but did not fully close that gap.
3. **Stale-session recovery is a peer-resolution problem, not an envelope problem.** The runtime already treats `pi-team--<task-id>--<role>--<launch-id>` as a parseable ID (`policy.mjs` `resolveTeamPeerRole` strips `pi-team--<task-id>--` and reads the role out of the prefix; the `launch-id` is informational, not authoritative for ACL). A session whose `launch_id` changes (resume, restart after `markStale`) can still be rediscovered by `intercom list-cwd` enumeration filtered by the same `task_id` and role. The lifecycle's `markStale` (`.pi/communication/lifecycle.mjs:13`) preserves partials and starts a new run under `runId:restart:<newPlanVersion>`; it does **not** preserve the prior launch_id. The recovery boundary that needs work is "what does the agent do when its cached `pi-team--<TASK--role--LAUNCH` ID no longer matches any live session?".

---

## 1. Current Base64 envelope exposure path (where the bytes actually live)

### 1.1 Encoding site (single source)

The envelope's body field is created in exactly one place: `.pi/communication/policy.mjs:62-77` (`makeEnvelope`):

```js
const encodedBody = Buffer.from(String(body), "utf8").toString("base64url");
return [
  "agent-team/v1",
  `id: ${id}`,
  `correlation_id: ${correlationId}`,
  `kind: ${kind}`,
  "body_encoding: base64url",
  `references: ${JSON.stringify({ ...(planVersion ? { plan_version: planVersion } : {}), ...(artifactPath ? { artifact_path: artifactPath } : {}) })}`,
  `subject: ${subject}`,
  `body: ${encodedBody}`,
].join("\n");
```

Round-trip canonicalisation is enforced on parse at `.pi/communication/policy.mjs:97-99` — any non-canonical base64url body is rejected with `invalid base64url body` / `non-canonical base64url body`. `tests/communication-policy.test.mjs` builds the same wire format at lines 262, 281, 304, 344, 717, 722, 804, so the wire is byte-identical to what the active tests assert.

### 1.2 Agent-facing surface

The agent never sees the encoding step. The role prompts (`.pi/agents/executor.md:44`, `.pi/agents/researcher.md` — through the matching skill) state explicitly: "The tool and runtime policy own envelope encoding and validation: never hand-construct JSONL/envelopes, base64, or call `.pi/communication/send.mjs` for ordinary sends." The runtime enforcement is in `.pi/communication/runtime-policy.mjs:73-75` and `.pi/communication/send.mjs:13` — both call `parseEnvelope` to verify the text is well-formed, and `runtime-policy.mjs` `onToolCall` further runs `researchBodyGate` (line 67-89) before the envelope is allowed to leave the runtime.

The Base64 body only re-appears in agent-facing surfaces when one of three things happens:

| Surface | Where Base64 can appear | Today |
| --- | --- | --- |
| Agent's outbound `intercom send` tool input (`event.input.message`) | only if the agent hand-rolled the envelope; runtime policy validates it | prompt-forbidden; runtime-checked |
| Agent's inbound context (`onContext` `intercom_message.details.bodyText`) | always — the transport delivers the wire envelope text | visible, but the agent's skill (`answer-research-question/SKILL.md` step 6) decodes it through `parseEnvelope` (or expects the runtime to have already done so) |
| Audit JSONL (`<auditDir>/<role>.jsonl`) | never (the audit row records `{direction, action, recipient, outcome, reason, messageId?, correlationId?, trace?}` only — no body) | clean |
| PersistentReplyStore (`<replyStoreDir>/<recipient>/<id>.json`) | the decoded reply body is stored as `record.reply` | exposes the decoded body on disk, but only the **completed** reply, only inside the runtime, only for replay (line 87-89 `persistent-store.mjs`) |
| Intercom outbox / handoff files on disk | runtime-side; not in scope | clean |

The decoded body reaches the persistent reply store ONLY when the runtime has already accepted the inbound (the BOOTSTRAP-SELF-004A fix moved `PersistentReplyStore.reserve` to **after** `PolicyReceiver.receive` at `runtime-policy.mjs:135-145`; see `failures/BOOTSTRAP-SELF-004A-unauthorized-reply-reservation.md` for the original report and `.pi/communication/runtime-policy.mjs:124-141` for the corrected ordering). So Base64 body exposure on disk is bounded to: (1) accepted inbound bodies already in `receiveAndReplay`'s reply path; (2) the outgoing envelope text carried by the `intercom` extension (this lives in transport, not the worktree).

### 1.3 Where Base64 has actually leaked historically (read-only evidence)

Two prior slices show the Base64 surface tripping real agents:

1. **PERF-004** — `reports/PERF-004-review.md:88`: "The Executor disclosed one incident inside the slice: a malformed intercom envelope during the READY_FOR_REVIEW send (a literal `+` in a hand-rolled base64url body), recovered by switching to `policy.makeEnvelope` + `parseEnvelope` pre-validation. Both temporary envelope files were cleaned up before handoff." This is direct evidence that Base64's canonical round-trip check at `policy.mjs:99` fires on a literal `+` (which is not in `^[A-Za-z0-9_-]+$` of valid base64url), and that the agent had reached for a hand-rolled encoder. The Reviewer's `Get-ChildItem -Recurse -File` filter for `*envelope*`/`*.b64*`/`*temp*intercom*` returned empty post-cleanup.
2. **ISSUE-001** — `reports/ISSUE-001-review.md:183-197` (R-1): a 956-byte untracked Node script `.pi/skills/answer-research-question/helper-encode.mjs` was observed during Reviewer. It emits an `agent-team/v1` envelope with a default body referencing the expected answer. Reviewer notes `.pi/skills/` is **not** in `.gitignore` (a factual error in `implementation_notes/ISSUE-001.md` §"Remaining risks" — `git check-ignore -v` returns empty), so the file remains untracked but visible. This is direct evidence that an agent was tempted to write a helper that bypassed `policy.makeEnvelope` even though the prompt says never to.

The Reviewer did **not** find the helper file in this worktree (`find '**/helper-encode*'` returns no results), confirming the file is task-scoped leakage, not durable guidance.

The **why** in both cases is the same: the Base64 step is opaque to the model. When the prompt says "send a `READY_FOR_REVIEW` envelope" and the model's training is on JSONL-style text, the natural reflex is to encode the body in some way. The runtime policy catches the malformed case at the gate, but the agent still burns a turn and writes temporary files. The fix is to move Base64 *entirely* behind a helper the agent never sees.

---

## 2. Session ID change recovery boundaries

### 2.1 What the runtime already supports

`.pi/communication/policy.mjs` `resolveTeamPeerRole(target, taskId)` (lines 105-112):

```js
const prefix = `pi-team--${taskId.toLowerCase()}--`;
const normalized = target.trim().toLowerCase();
if (!normalized.startsWith(prefix)) return undefined;
const role = normalized.slice(prefix.length).split("--", 1)[0];
return ROLES.includes(role) ? role : undefined;
```

The role is parsed from the prefix `pi-team--<task-id>--<role>`. Everything after the role (the `--<launch-id>`) is **ignored** for ACL purposes. So a session whose `launch-id` changes is still resolved to the same role and the same task scope.

`tests/communication-policy.test.mjs` asserts this: "stable Pi Team intercom identities are task-scoped" — `resolveTeamPeerRole("pi-team--PERF-003--executor--lease-1", "PERF-003") === "executor"`, and the cross-task case `resolveTeamPeerRole("pi-team--PERF-004--executor--lease-1", "PERF-003") === undefined`. This is the recovery primitive: a peer ID with the right task and right role prefix is ACL-eligible, regardless of the launch-id segment.

`tests/team-contract.test.mjs` proves that `start` writes the **persisted** `session_id` into the launch record and that `resume` reuses it (`assert.equal(resumedExecutor.agent_id, executorAgentId, "resume must reuse Executor Agent ID")`). So under the current contract, the launch-id is stable for the lifetime of a single Executor/Reviewer pair.

### 2.2 When the launch-id can change anyway

Three paths cause a launch-id to change:

1. **`resume` after `cleanup`** — `resume` reads `<stateRoot>/<task-id>.json` and reuses the persisted `session_id`. If the state file is missing or has been re-initialised (e.g. after `accept` → `archive` → fresh `start`), the session ID is a new value.
2. **`markStale` followed by a new run** — `.pi/communication/lifecycle.mjs:14-25` writes a new run file at `${runId}:restart:${newPlanVersion}` and a fresh `process_chain`; the role session attached to the old run is not necessarily killed, but its launch-id is no longer the "current" run.
3. **Role crash and re-launch** — if the runtime registers a new session under a new launch-id (because the old PID exited and the launcher replaces it), the new ID has the same task/role prefix but a different launch-id.

In all three cases, `resolveTeamPeerRole` still resolves correctly **provided the agent calls `intercom list-cwd` and replaces its cached `pi-team--<task-id>--<role>--<launch-id>` with whatever the broker reports**. The runtime has no built-in mechanism to broadcast a new launch-id to peers; agents must re-discover.

### 2.3 The recovery boundary Issue #11 must close

The gap is not in `resolveTeamPeerRole`; it is in **how an agent recovers when its cached peer ID no longer appears in `intercom list-cwd`**. Today's contract: "Before a send, call `intercom list-cwd`, select the same-task paired … ID". If `list-cwd` returns zero entries (or returns the wrong task/role), the agent has no fall-back; `resolveTeamPeerRole` returns `undefined` and `runtime-policy.mjs:onToolCall` returns `{ block: true, reason: "Agent communication policy refused ..." }`.

The recovery shape the contract should adopt:

- Same-task rediscovery: re-enumerate the broker with the same `PI_TEAM_TASK_ID` and pick the first session whose role matches the bounded peer (researcher ↔ executor; executor ↔ reviewer). If no such session exists, return a typed recovery failure (e.g. `peer_unreachable`) with the same task/scope/role context — never silently fall through to a different task or a different role.
- Cross-task rediscovery: **forbidden**. A session from a different `task_id` fails the prefix check at `policy.mjs:107` and `resolveTeamPeerRole` returns `undefined`. Any "discovered" cross-task session must not be accepted as a peer.
- Lead-issued rediscovery: out of scope for Issue #11. Lead can already mirror via `intercom list-cwd` from the Lead session (when Code peer participation is wired) and reach a peer through its launch-id; this is unchanged.

---

## 3. Log redaction fields (audit and reply-store)

### 3.1 Current audit shape

`.pi/communication/runtime-policy.mjs:26-29` (`appendPolicyAudit`) writes a JSONL row per event:

```js
const record = { at: new Date().toISOString(), role, ...event };
await appendFile(join(auditDir, `${role}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
```

The callers (`auditSafely(...)` calls throughout `onToolCall`, `onContext`, `receiveAndReplay`) write only the structured fields. The agent-facing leakage surface here is **zero** because the body is never copied into the audit row — the body reaches the audit only via the rejected-`message` path (`outcome: "refused", reason: "Agent communication policy refused malformed send: <error.message>"`), where `error.message` is one of the `parseEnvelope` errors (`"malformed envelope"`, `"invalid envelope fields"`, `"unknown envelope field"`, `"unsupported body encoding"`, `"missing references"`, `"invalid references"`, `"expired message"`, `"invalid message body"`, `"invalid base64url body"`, `"non-canonical base64url body"`, `"invalid body encoding"`). None of these messages include the body itself.

For accepted sends, the audit carries `messageId` and `correlationId` (both UUIDs, never the body). The `trace` field carries the `refuse-before-intercom` event when peer ACL refuses — again, no body.

### 3.2 Current reply-store shape

`.pi/communication/persistent-store.mjs:30-41` (`write`):

```js
await writeFile(temp, JSON.stringify({ id, recipient, status: "completed", completedAt: now, reply }), "utf8");
```

The completed reply body is persisted on disk at `<replyStoreDir>/<recipient>/<id>.json` ONLY when `runtime-policy.mjs:onContext` accepts the inbound AND `outgoingReply?.kind === "reply"` AND the writer was `sendWithPolicy`. The path is reachable only through the runtime hook; the file is keyed by recipient + UUID, so it survives crashes for replay (60-minute window).

The `replyStore.read()` path (lines 22-29) returns `undefined` if the recipient or id mismatch or if the timestamp is past the window. The reply-store is therefore **not** an attacker-reachable Base64 dump: the keys are auth-bounded by `recipient` and `id` (the same `(id, recipient)` pair that `DedupStore.accept` tracks for 60 minutes — see `policy.mjs:121-130`).

### 3.3 What redaction Issue #11 should add

The minimal redaction contract that fits the existing audit shape:

- For accepted sends, record `kind`, `subject` (≤80 chars, never the body), `id`, `correlationId`, `recipient`, `outcome`, `references` (parsed JSON, NOT the `body` line), and the structured diagnostic fields specific to RESEARCH_* (`type`, `decision_supported`, `artifact_path`, `confidence` when present). Do not record the raw `body: <base64url>` line.
- For refused sends, record the same plus the `reason` (which is the structured error code or the gate's reason chain).
- The reply-store write path is unchanged: the reply body is the decoded application payload, already bound to the recipient+id, and is the source of truth for replay. No Base64 crosses this boundary because the writer receives a decoded `reply` string from the runtime hook.

The decision rule: never let a `body: <base64url>` line cross the audit or reply-store write boundary. The wire envelope text itself never leaves the runtime; only its decoded application body (already JSON for `RESEARCH_*`, otherwise opaque plain text) reaches the store.

---

## 4. Compatibility constraints (what cannot change)

Issue #11's `out_of_scope` (`.pi/communication/README.md` and `plans/ISSUE-011-task.md`) lists:

- 替换 agent-team/v1 wire envelope、取消 body encoding 校验或破坏现有消息兼容性
- 扩大 BOUNDED_PEERS、task/scope/role 授权、Lead 权限或 artifact 所有权

What this maps to in code:

- `makeEnvelope` header line `"agent-team/v1"` (`.pi/communication/policy.mjs:68`) is the wire version tag; changing it breaks every test that asserts the header.
- `body_encoding: base64url` (line 72) and the canonical round-trip check at lines 97-99 are the body-encoding gate; removing them allows non-canonical payloads (the `+` problem from PERF-004).
- `BOUNDED_PEERS` (`.pi/communication/policy.mjs:18-23`) defines the role-level ACL; widening it changes ADR 0002 §"Allowed routes".
- `resolveTeamPeerRole` (lines 105-112) is the only prefix parser that the runtime policy uses to resolve `pi-team--<task-id>--<role>--<launch-id>`; changing the format breaks every assertion in `tests/team-contract.test.mjs` "role launchers inject common-dir identity and isolate Executor/Reviewer environments" (`record.args[record.args.indexOf("--session-id") + 1] === startState.sessions[record.role].session_id`).
- `KINDS = new Set(["request", "reply", "error", "progress"])` (line 24) and the `id`/`correlation_id` UUID v4 requirement (line 17, 86) gate the wire shape.
- The audit fields (`direction`, `action`, `recipient`, `outcome`, `reason`, `messageId`, `correlationId`, `trace`) are the Lead observation surface; adding fields is fine, but removing `recipient` or `outcome` breaks Lead retrospection.

Lead observation boundary (`.pi/communication/README.md` line 31): the runtime policy never lets the agent see what another agent sent or received; it only sees the audit aggregate and the reply store for its own messages. The BlackBoard event shape (`.pi/communication/extensions/blackboard-update.ts`) only accepts `{state, activity, blocker?, next?}` and never carries envelope bodies. The Blackboard observability contract is preserved.

---

## 5. task / scope / role / peer ACL constraints

The ACL layers that Issue #11 must keep intact (in nesting order, outermost first):

1. **Task scope** — `PI_TEAM_TASK_ID` injected by the launcher (`tests/team-contract.test.mjs` "role launchers inject common-dir identity…"); used by `authorizeResearchDelegation` (`policy.mjs:329-354`) to refuse cross-task requests.
2. **Delegation ID** — `delegation_id` field on `RESEARCH_REQUEST` / `RESULT` / `BLOCKED`; must equal the contract's `delegations[researcher].id` (e.g. `RESEARCH-ISSUE-011`). Refused at `policy.mjs:332-333` with `research-delegation-id-unknown`.
3. **Role scope** — `BOUNDED_PEERS` (line 18-23) + `KINDS` (line 24); the active role names are `researcher`, `executor`, `reviewer` (line 19, also asserted by `tests/team-contract.test.mjs` "exactly three active agents and no other role files in .pi/agents").
4. **Peer resolution** — `resolveTeamPeerRole(target, taskId)` (line 105) parses `pi-team--<task-id>--<role>--<launch-id>` and is the only path that the runtime uses to map a free-form target to a role for the outbound gate (`runtime-policy.mjs:62-66`).
5. **Body schema** — `validateResearchBody` (line 199-308) + `authorizeResearchDelegation` (line 329-354); only invoked when the body decodes to a JSON object whose `type ∈ RESEARCH_MESSAGE_TYPES` (`runtime-policy.mjs:78`); non-research messages pass through untouched.

Approach A (keep wire envelope + structured helpers + same-task rediscovery) preserves all five layers without modification: it only adds (a) a thin helper that the agent calls instead of `intercom({action:"send", to, message})`, where the helper takes structured fields (`to`, `kind`, `subject`, decoded `body` object, `references`) and calls `makeEnvelope` + `sendWithPolicy` internally; and (b) a recovery helper that takes the cached `pi-team--<task-id>--<role>--<launch-id` and either re-validates via `list-cwd` or returns a typed recovery failure. Neither helper introduces a new wire field, a new role, or a new peer.

Approach B (modify or replace the envelope) touches all five layers. Even a minimal "remove base64url, switch to UTF-8 JSONL" replacement changes the canonical check at `policy.mjs:99`, the body-encoding key at line 72, and the parse path at lines 79-103; it requires new test cases for the new wire shape, and it breaks `tests/team-contract.test.mjs`'s assumptions about the launch record's `args` (`record.args.includes("agent-team/v1")` is asserted via the contract test's `--append-system-prompt` machinery).

---

## 6. Verifiable scenarios

### 6.1 Positive scenarios (must pass)

- **P1**: same-task paired peer rediscovery. `pi-team--ISSUE-011--researcher--launch-A` becomes `pi-team--ISSUE-011--researcher--launch-B` (after a `markStale` + new run). Executor's helper re-validates via `list-cwd`, picks `launch-B`, `resolveTeamPeerRole("pi-team--ISSUE-011--researcher--launch-B", "ISSUE-011") === "researcher"`, `runtime-policy.mjs:onToolCall` allows. Audit row records `direction: "outbound", recipient: "researcher", outcome: "allowed", messageId: <new UUID>`.
- **P2**: structured send without exposing base64. Executor calls helper with `{to, kind, subject, body: {type: "RESEARCH_REQUEST", ...}}`; helper builds envelope via `makeEnvelope`; agent never observes `body_encoding: base64url`. The agent-facing log line is `intercom.send(to=pi-team--ISSUE-011--researcher, kind=request, subject=...)` without the envelope text.
- **P3**: completed-reply replay. Researcher accepts the inbound, writes `record.reply` via `PersistentReplyStore.write`; Executor's helper receives the inbound and reads `record.reply` instead of re-decoding. The decoded body is already a JSON object when it reaches the helper.
- **P4**: existing Issue #3 tests pass unchanged (the 21 tests in `tests/communication-policy.test.mjs` lines 467-807 cover Issue #3's allow scheme; they must stay green).

### 6.2 Negative scenarios (must pass)

- **N1**: cross-task peer rediscovery. Executor in `ISSUE-011` calls helper against `pi-team--ISSUE-010--researcher--launch-A`; `resolveTeamPeerRole` returns `"researcher"` BUT `authorizeResearchDelegation` refuses because `task_id === "ISSUE-010" !== PI_TEAM_TASK_ID === "ISSUE-011"`. Audit row records `outcome: "refused", reason: "research-task-id-mismatch"`. (This is the existing `N1` test in `tests/communication-policy.test.mjs:658-678`; reuse the assertion.)
- **N2**: cross-role peer rediscovery. Executor in `ISSUE-011` calls helper against `pi-team--ISSUE-011--reviewer--launch-B` after Researcher died and Reviewer is the only live peer. `resolveTeamPeerRole` resolves to `"reviewer"`, but `researchBodyGate` (when sending a `RESEARCH_REQUEST`) refuses with `research-recipient-mismatch:RESEARCH_REQUEST:executor-must-target-researcher`. The helper must surface this as a typed `peer_wrong_role` failure rather than retry.
- **N3**: stale-session recovery when no peer exists. Executor in `ISSUE-011` calls helper against `pi-team--ISSUE-011--researcher--launch-DEAD` and `list-cwd` returns no Researcher session for `ISSUE-011`. Helper returns typed `peer_unreachable:role=researcher:task_id=ISSUE-011`; the runtime does NOT auto-spawn a Researcher session (that would require Lead's `pi-team.cmd research`).
- **N4**: malformed envelope from hand-rolled helper. Agent invokes the helper with a `body` whose JSON.stringify result produces an empty string; helper catches the empty-subject / empty-body error from `makeEnvelope` (`subject.length > 80`, `!body`) and returns a structured failure without touching `intercom`. This is the same case that produced PERF-004's `+` body; it should not reach the runtime gate.
- **N5**: out-of-scope `allowed_paths`. Researcher receives a `RESEARCH_REQUEST` whose `allowed_paths` includes a path outside the frozen contract's `in_scope`. `validateResearchBody` does NOT currently check `allowed_paths` against the contract (Issue #3 §3.1 documents it as a runtime rule but the implementation is left to `runtime-policy.mjs:researchBodyGate`'s `out_of_scope` reason_code). For Issue #11, the negative scenario is: helper surfaces the refusal via the same `RESEARCH_BLOCKED reason_code: "out_of_scope"` path, with the `next_decision_needed` field populated.
- **N6**: rejected inbound reply-store write (regression for BOOTSTRAP-SELF-004A). A researcher → reviewer inbound with a structurally valid envelope must NOT create a pending reservation file. Helper must surface this as a typed `unauthorized_sender` failure and not surface the body to the agent.

### 6.3 Control scenarios (regression coverage)

- **C1**: `tests/communication-policy.test.mjs` line 467-807 (Issue #3 allow scheme) stays green — wire shape, kind set, base64url round-trip, body gate, cross-task refusal, malformed BLOCKED filtering.
- **C2**: `tests/team-contract.test.mjs` "role launchers inject common-dir identity…" stays green — launch-id binding, scope_id binding, resume reuse, per-role prompt content.
- **C3**: `tests/blackboard.test.mjs` stays green — common-dir state root, Lead-only task creation, agent append-only events, cursor watching.
- **C4**: new helper-level tests under `tests/communication-policy.test.mjs` for: (a) helper produces a canonical envelope from structured fields; (b) helper rejects when `resolveTeamPeerRole` returns undefined (typed failure, NOT raw `intercom` error); (c) helper redacts the audit row to structured fields only; (d) stale-session rediscovery re-validates the `task_id` prefix even when the launch-id changes; (e) the same-task paired role is the ONLY fallback (never cross-task, never cross-role, never a hand-written launch-id).

---

## 7. Approach A vs Approach B (decision matrix)

| Dimension | A — keep wire envelope + structured send helper + structured audit + same-task rediscovery | B — modify or replace envelope |
| --- | --- | --- |
| Wire compatibility | byte-identical wire (`agent-team/v1`, `body_encoding: base64url`, kind set, UUID shape, `references` JSON) | new wire shape; every existing wire-shape test rewrites |
| Body encoding gate | unchanged — `parseEnvelope` canonical base64url check at `policy.mjs:97-99` keeps PERF-004's `+`-body failure mode | must be redesigned (different encoding, or remove encoding) |
| Cross-task / cross-role / cross-delegation refusal | unchanged — `authorizeResearchDelegation`, `validateResearchBody`, `BOUNDED_PEERS` byte-identical | must be redesigned; new tests required for new shape |
| Issue #3 research envelope | unchanged (21 tests stay green) | regressed; new schema mapping required |
| Lead observation boundary | unchanged — audit shape gains optional structured fields (`kind`, `subject`, `references`, `decision_impact`) without removing `recipient` / `outcome` | audit shape must change; Lead retrospection tools break |
| Agent-facing base64 exposure | moves behind helper; agent observes only `kind`, `subject`, `id`, `correlation_id`, structured `references` | eliminated at the wire, but at the cost of breaking everything else |
| Stale-session recovery | same-task `list-cwd` re-validation with prefix check at `resolveTeamPeerRole`; typed `peer_unreachable` / `peer_wrong_role` failure modes | unchanged at the runtime layer; only the wire changes |
| Temporary hand-rolled helper files | helper writes are runtime-side (no agent-visible file); `helper-encode.mjs`-style leakage eliminated because the helper lives in `.pi/communication/` and the prompt forbids hand-encoding | leakage impossible by definition (no envelope), but the helper still needs a typed surface for the agent |
| Rollout risk | low — additive change, no contract break | high — breaks every wire assertion, every Issue #3 test, every Issue #1 review's prompt-boundary contract |
| Issue #11 contract compliance | ✅ all six `out_of_scope` clauses respected | ❌ violates "替换 agent-team/v1 wire envelope" and "取消 body encoding 校验或破坏现有消息兼容性" |

**Recommendation: Approach A.** Approach B violates Issue #11's `out_of_scope`; it also touches every wire-shape assertion in `tests/communication-policy.test.mjs` and `tests/team-contract.test.mjs` without a corresponding reduction in operational risk (PERF-004's malformed body and ISSUE-001's helper-encode.mjs are evidence of *agent* misbehaviour, not envelope misbehaviour — the fix is to move the encoding step out of the agent's reach, not to redesign the encoding).

---

## 8. Open contradictions and gaps

- **G1**: no replay path for `scope_change` envelopes. The scope-change event is delivered through `onContext` with `customType: "scope_change"` and is handled by `markStale` (`runtime-policy.mjs:onContext` lines 150-159). A scope change is NOT a regular `intercom_message`; the helper must not try to rediscovery a peer through it. Document this asymmetry in the helper.
- **G2**: `launch-id` is informational, not authoritative. `resolveTeamPeerRole` parses only the prefix. If an agent caches `pi-team--ISSUE-011--researcher--launch-A` and `launch-A` is a dead session, the helper must enumerate `list-cwd` rather than trust the cache. The cache is a hint; the prefix check is the gate.
- **G3**: `DedupStore` window is 60 minutes (`policy.mjs:121-130`). A rediscovery that re-sends a message with a new UUID is NOT a duplicate; a rediscovery that re-sends with the same UUID (because the agent forgot it had already sent) IS a duplicate. The helper must generate a fresh UUID per send; the existing `request_id` rule (Issue #3 §3.1) is the same constraint.
- **G4**: Lead observation boundary. `.pi/communication/README.md` line 31 says "the runtime policy never lets the agent see what another agent sent or received". The helper must preserve this: a `peer_unreachable` failure must NOT leak the new launch-id the helper discovered from `list-cwd` (it can include the `role` and `task_id`, both of which the agent already knows). The session ID itself is Lead/transport-private.
- **G5**: `RESEARCH_REQUEST` budget. Issue #3 §"Remaining risks" recommends a cap of 3 research requests per Executor slice. The helper does not currently enforce this; if Issue #11 introduces a budget, it must be a typed count returned by the runtime, not an agent-side counter.
- **G6**: cross-task test isolation. The existing `N15` test (`tests/communication-policy.test.mjs:758-781`) cross-task-filters inbound `RESEARCH_RESULT` and asserts the audit row contains `task-id-mismatch`. The helper-level rediscovery test must verify the same filter on outbound: a same-task helper call from `ISSUE-011` whose target resolves to a `PERF-003` session must refuse with `task-id-mismatch`, NOT silently redeliver to the `PERF-003` peer.

---

## 9. Confidence and caveats

- **Confidence: high** for the wire-shape and ACL analysis (every claim is anchored in a specific file:line or test:line).
- **Confidence: medium** for the recovery primitive (the primitive is the prefix parser at `policy.mjs:105-112`, but the actual rediscovery helper is not in the code today; the shape is inferred from `runtime-policy.mjs:onContext`'s prefix-based reasoning and `tests/communication-policy.test.mjs`'s prefix-based assertions).
- **Confidence: medium** for the redaction field set (the audit shape is open today — `record = { at, role, ...event }` — so the exact new fields are a Lead decision, not a research finding; this artifact proposes the minimal set consistent with `runtime-policy.mjs`'s existing event payloads).
- **Caveats**:
  - This artifact does not propose a concrete wire change. The Issue #11 contract forbids it; Approach A is the only path.
  - The helper's typed-failure surface (`peer_unreachable`, `peer_wrong_role`, `unauthorized_sender`, `peer_wrong_task`) is a proposal for the Executor's contract, not a Lead decision.
  - `helper-encode.mjs` and the PERF-004 `+`-body incident are historical evidence from sibling worktrees; this worktree does not contain them.
  - The Lead observation boundary depends on the BlackBoard event shape (`.pi/communication/extensions/blackboard-update.ts`) which only accepts `{state, activity, blocker?, next?}`; this is unchanged by Issue #11.

## Sources (read-only)

Local files cited above (no system commands run; no `web_search`; no Gold / oracle / expected-patch / answer-derived data accessed):

- `.pi/communication/policy.mjs:18-30, 62-103, 105-112, 121-130, 199-308, 329-354`
- `.pi/communication/send.mjs:1-25`
- `.pi/communication/runtime-policy.mjs:26-29, 62-89, 121-145, 150-159`
- `.pi/communication/persistent-store.mjs:22-41`
- `.pi/communication/lifecycle.mjs:13-25`
- `.pi/communication/extensions/{researcher,executor,reviewer,report-to-lead,blackboard-update}.ts`
- `.pi/communication/pi-policy-extension.ts`
- `.pi/communication/README.md`
- `.pi/agents/{researcher,executor,reviewer}.md`
- `.pi/skills/{answer-research-question,execute-delegated-task}/SKILL.md`
- `tests/communication-policy.test.mjs:251-329, 467-807`
- `tests/team-contract.test.mjs` ("role launchers inject common-dir identity and isolate Executor/Reviewer environments", "report_to_lead event storage continues sequences across concurrent appends")
- `tests/run-tests.ps1`
- `tests/blackboard.test.mjs` (header)
- `ADR/0002-lead-subagent-collaboration-protocol.md`
- `ADR/0005-agent-blackboard-observability.md`
- `.pi/decisions/2026-08-21-agent-team-communication-baseline.md`
- `AGENTS.md`
- `README.md`
- `architect.md`
- `project_state.md`
- `plans/ISSUE-011-task.md` (frozen contract)
- `reports/ISSUE-001-review.md:163, 177, 183-197, 228`
- `reports/PERF-004-review.md:88`
- `implementation_notes/ISSUE-001.md:16-19` (Issue #1's RESEARCH_RESULT evidence)
- `implementation_notes/ISSUE-003.md:33-43` (Issue #3's allow scheme evidence)
- `failures/BOOTSTRAP-SELF-004A-unauthorized-reply-reservation.md` (reply-store ordering evidence)

End of research artifact.
