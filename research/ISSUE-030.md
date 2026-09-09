# ISSUE-030 — Blackboard-to-Lead wakeup and context path read-only investigation

- Task ID: **ISSUE-030**
- Research delegation: **RESEARCH-ISSUE-030**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-030`
- Frozen scope (read-only): `plugins/agent-blackboard/server/{blackboard-core.mjs, blackboard-mcp.mjs, lead-wakeup-adapter.mjs, blackboard-cli.mjs}`, `plugins/agent-blackboard/skills/{pi-team-lead, blackboard-lead}/SKILL.md`, `.pi/communication/{policy.mjs, runtime-policy.mjs, extensions/blackboard-update.ts}`, `tests/blackboard.test.mjs`, `tests/team-contract.test.mjs`, `tests/communication-policy.test.mjs`, `README.md`, `AGENTS.md`, `ADR/0002-lead-subagent-collaboration-protocol.md`, `ADR/0005-agent-blackboard-observability.md`, `project_state.md`, `architect.md`, `research/ISSUE-011-intercom-envelope-recovery.md`, `research/ISSUE-003-bounded-research-protocol.md`, `research/BOOTSTRAP-SELF-005-node-test-exit-code.md`, `reports/PERF-004-review.md`, `reports/ISSUE-001-review.md`, `failures/BOOTSTRAP-SELF-004A-unauthorized-reply-reservation.md`. (Per the active Lead task context.)
- Constraints honored: no system commands run, no production-code edits, no test edits, no Scout / sub-question decomposition, no reads from Gold / oracle / expected-patch / answer-derived data. Web search used only as supporting reference per the task brief; GitHub URLs were unreachable through the configured `fetch_content` (SSRF filter on 198.18.0.0/15) and were skipped in favor of local evidence.

## Question (one sentence)

Read-only: what is the current end-to-end path by which a meaningful Blackboard update wakes a bound Lead, injects a context summary, deduplicates via a caller-owned cursor, survives concurrent dispatcher and Agent activity, and degrades safely on failure — and what is the smallest safe fix boundary plus the positive/negative scenarios Issue #4 must satisfy without turning the Blackboard into a control bus?

## Headline answer (1–3 sentences)

1. **The path exists and is partially implemented, but several gaps remain.** `appendAgentEvent` enqueues a `lead_wakeup` only when the role state is one of `LEAD_WAKE_STATES = {"blocked", "changes_requested", "ready_for_review", "ready_for_acceptance", "completed"}` (`plugins/agent-blackboard/server/blackboard-core.mjs:13`), `registerLead` / `unregisterLead` establish an explicit per-task `(thread_id, host_id)` binding (`blackboard-core.mjs:452-490`), and `dispatchLeadWakeups` (`plugins/agent-blackboard/server/lead-wakeup-adapter.mjs:43-66`) calls the host adapter with `maxAttempts = 3`, persists `delivered` / `failed` results through `recordLeadWakeupDelivery`, and lets the host `acknowledgeLeadWakeup` only when the wakeup's `delivery_id` matches. The cursor lives on the *snapshot* (`blackboard-core.mjs:172-190, 271-285`), is caller-owned, and is the only path for at-least-once Agent event observation (`blackboard-core.mjs:286-292`, `tests/blackboard.test.mjs` "snapshot exposes active critical changes with a caller-owned cursor").
2. **The minimum safe Issue #4 surface is `(Lead binding) ⇄ (wakeup adapter) ⇄ (host deliver / ack)` with a per-wakeup `delivery_id` reconciliation and the existing `LEAD_WAKE_STATES` filter.** Adding context-summary injection is safe only when the formatter redacts raw envelope bytes, the per-task binding is unchanged by any state change other than an explicit `unregisterLead`, and the wakeup adapter does not assume the host is always available (`lead-wakeup-adapter.mjs:55-66` already surfaces a `failed` state but does not currently drive a `blackboard_snapshot`-only retry policy). The known gaps are concurrency (the adapter does not use `claimLeadWakeup` despite that primitive existing at `blackboard-core.mjs:566-585`), cross-event summary merging, and failure-degradation policy when the host binding is missing or stale.
3. **Positive and negative verification scenarios already exist for binding, retry, and cursor paths** (`tests/blackboard.test.mjs` "critical Agent events enqueue a bound Lead wakeup…", "Lead wakeup adapter delivers, records, acknowledges, and retries host failures", "Lead wakeup binding is explicit and isolated per task"). Issue #4 must add a context-summary scenario (a single critical event produces a stable summary; two critical events inside the same call do not double-deliver; an un-bound task never invokes the host adapter), and it must keep the Blackboard an *observation / reminder* plane (`README.md:69-91`, `ADR/0005-agent-blackboard-observability.md`, `plugins/agent-blackboard/skills/pi-team-lead/SKILL.md` "Use Agent Blackboard as the Lead-owned observability plane with wakeup reminders. … Wakeups are not authorization or completion proof.").

---

## 1. Confirmed behavior (local code + tests)

### 1.1 Critical-event filter — `LEAD_WAKE_STATES`

- **Source.** `plugins/agent-blackboard/server/blackboard-core.mjs:13`:
  ```js
  export const LEAD_WAKE_STATES = new Set(["blocked", "changes_requested", "ready_for_review", "ready_for_acceptance", "completed"]);
  ```
  The role-level state allowlist for `blackboard_update` is `ROLE_STATES` (lines 7-11); `LEAD_WAKE_STATES` is the *intersection* of role states that warrant a Lead reminder, and it is the only set used by wakeup creation (`appendAgentEvent` line 631) and by `snapshot.changes` (line 275).
- **Witness.** `tests/blackboard.test.mjs` "critical Agent events enqueue a bound Lead wakeup and non-critical events stay quiet" — `working` and `waiting` events do **not** produce a wakeup (`assert.deepEqual((await listLeadWakeups(...)).wakeups, [])`), while `ready_for_review` does (`queue.wakeups[0].id === "BB-WAKE-001:executor:<sequence>"`).
- **Design boundary.** "Critical states … enqueue a Lead reminder. Blackboard remains an observability and reminder plane, not authorization, completion proof, or a communication receipt." (`.pi/communication/extensions/blackboard-update.ts:23` description, mirrored in `plugins/agent-blackboard/skills/blackboard-lead/SKILL.md:29-31`).

### 1.2 Wakeup identity — `(task_id, role, event_sequence)`

- **Source.** `plugins/agent-blackboard/server/blackboard-core.mjs:60-80`:
  ```js
  function wakeupId(taskId, role, sequence) {
    return `${taskId}:${role}:${sequence}`;
  }
  function makeLeadWakeup(event) {
    const wakeup = {
      id: wakeupId(event.task_id, event.role, event.sequence),
      version: 1,
      task_id: event.task_id, role: event.role, sequence: event.sequence,
      state: event.state, activity: event.activity,
      created_at: event.observed_at, status: "pending", attempts: 0,
    };
    if (event.blocker !== undefined) wakeup.blocker = event.blocker;
    if (event.next !== undefined) wakeup.next = event.next;
    return wakeup;
  }
  ```
- **Deduplication property.** The id is deterministic; `appendAgentEvent` (line 631) uses `wakeups.some((item) => item.id === wakeupId(...))` to guarantee one wakeup per (task, role, sequence) — this is the application-level idempotency key. `tests/blackboard.test.mjs` "event log must recover a missing wake record" (lines 269-272) proves the recovery path: even when the persisted `lead_wakeups` array is wiped, the next `listLeadWakeups` call's `reconcileWakeupStore` re-derives the same wakeup from the JSONL event log (`blackboard-core.mjs:87-101`). This is the *degraded-state recovery* mechanism; the cursor is unrelated.
- **Caveat.** Recovery relies on the `JSONL` event log being the source of truth for wakeups; it does **not** track `attempts`, `delivery_id`, `last_error`, or `last_attempt_at` (those live only on the persisted task file). The implication for Issue #4: a manually edited event log can re-create a wakeup, but the wakeup will start with `status: "pending"` and `attempts: 0`. The `claimLeadWakeup` / `recordLeadWakeupDelivery` paths will then re-attempt delivery as if it were the first try.

### 1.3 Lead binding — explicit, per-task, immutable while registered

- **Source.** `plugins/agent-blackboard/server/blackboard-core.mjs:452-490` (`registerLead`) and `491-507` (`unregisterLead`). The binding carries `thread_id` and `host_id`; re-registering the same `(thread_id, host_id)` is idempotent, a *different* pair fails with "task already has a different Lead binding". `unregisterLead` accepts an optional `(thread_id, host_id)` argument that must match before the binding is cleared.
- **Witness.** `tests/blackboard.test.mjs` "Lead wakeup binding is explicit and isolated per task" — the cross-task isolation case asserts `await assert.rejects(registerLead(fixture.repo, "BB-WAKE-A", { thread_id: "lead-other", host_id: "local" }), /different Lead binding/)` and that the wakeup sent for task A never appears in the queue for task B.
- **Design boundary.** "An active task may also have one explicit Lead thread binding." (`ADR/0005-agent-blackboard-observability.md:26-31`). The binding is a single `(thread_id, host_id)` per task; there is no concept of a "second Lead" or fan-out.

### 1.4 Wakeup adapter — delivery, retry, ack

- **Source.** `plugins/agent-blackboard/server/lead-wakeup-adapter.mjs:43-66`:
  ```js
  export async function dispatchLeadWakeups(projectRoot, taskId, sendMessageToThread, { maxAttempts = 3 } = {}) {
    if (typeof sendMessageToThread !== "function") throw new TypeError("sendMessageToThread must be a function");
    const queue = await listLeadWakeups(projectRoot, taskId);
    if (!queue.binding) return { task_id: taskId, binding: null, delivered: [], skipped: queue.wakeups };
    const delivered = [];
    const skipped = [];
    for (const wakeup of queue.wakeups) {
      if (wakeup.status === "delivered" || Number(wakeup.attempts || 0) >= maxAttempts) { skipped.push(wakeup); continue; }
      const request = createLeadWakeupRequest(queue.binding, wakeup);
      try {
        const result = await sendMessageToThread(request);
        const accepted = result?.accepted === true || result?.delivered === true || result?.threadId === queue.binding.thread_id;
        const deliveryId = result?.delivery_id || result?.threadId || randomUUID();
        const recorded = await recordLeadWakeupDelivery(projectRoot, taskId, wakeup.id, accepted
          ? { delivered: true, delivery_id: deliveryId }
          : { delivered: false, error: result?.reason || "host-rejected-wakeup" });
        delivered.push(recorded.wakeup);
      } catch (error) {
        const recorded = await recordLeadWakeupDelivery(projectRoot, taskId, wakeup.id, { delivered: false, error: error.message });
        delivered.push(recorded.wakeup);
      }
    }
    return { task_id: taskId, binding: queue.binding, delivered, skipped };
  }
  ```
- **Retry semantics.** `maxAttempts = 3` is the only retry knob; after the third failed attempt the wakeup is permanently skipped (it never re-enters `queue.wakeups` for another `dispatchLeadWakeups` call). The reason field is a single line; failed attempts set `wakeup.last_error` and `wakeup.attempts += 1` but never a structured retry class.
- **Ack contract.** `acknowledgeLeadWakeup` (`blackboard-core.mjs:587-605`) requires `delivery_id` to match the recorded value before transitioning to `status: "acked"`. A mismatch raises "delivery does not match Lead wakeup: <id>" (proven by `tests/blackboard.test.mjs:303-307`).
- **Prompt shape.** `formatLeadWakeup` (`lead-wakeup-adapter.mjs:18-30`) produces a single-line-per-field plain text summary (`task_id=…`, `role=…`, `event_sequence=…`, `state=…`, `activity=…`, optional `blocker=…` and `next=…`) and is **specifically hostile to Base64 / JWT-shaped content** (the `summary` helper redacts patterns matching `^[A-Za-z0-9+/_-]{32,}=*$` or `^eyJ[A-Za-z0-9+/_-]{20,}` to `[transport payload redacted]`). The redactor test asserts this: `assert.doesNotMatch(request.prompt, /base64|eyJ[A-Za-z0-9]/i)`. This is the only context-summary path the wakeup adapter currently exposes, and it is purely activity text plus the structural fields — no Agent body or contract text is included.
- **What is NOT in the prompt today.** The wakeup summary does **not** include: the current Lead task `name` / `description` (the Lead is expected to call `blackboard_snapshot` to get that — `skills/pi-team-lead/SKILL.md` "inspect the current Blackboard snapshot, contract, diff, and artifacts before deciding the next Lead action"); the previous event's summary; the diff or artifact path. The prompt is a reminder, not a stand-alone replacement for Lead inspection.

### 1.5 Cursor dedup — caller-owned, at-least-once

- **Source.** `blackboard-core.mjs:172-190` (cursor codec), `271-285` (`snapshotChanges`), `286-292` (`snapshot` returns `cursor: cursorFor(eventItems, cursor)`), and `635-657` (`watch` polls up to `MAX_WATCH_MS = 55_000` and returns only `eventsAfter` against the caller-owned cursor).
- **Witness.** `tests/blackboard.test.mjs` "snapshot exposes active critical changes with a caller-owned cursor" — establishes baseline, requests a second snapshot with the same cursor, asserts `changes: []` (no duplicates). The reverse case ("watcher returns causally on Agent activity and stays quiet for metadata-only changes") proves metadata-only `updateTask` calls do **not** enqueue Agent events, so a stale cursor cannot pick them up. Metadata-only updates cannot cause spurious wakes.
- **Cursor shape.** The cursor is `base64url(JSON.stringify({version:1, files:{ "<jsonl filename>": <max sequence seen> }}))`. The file key is the JSONL file name (`<task-id>-<role>.jsonl`), the value is the highest `event.sequence` already observed for that file. Decoding is rejection-strict: `decodeCursor` raises "invalid blackboard cursor" for any non-`{version:1, files:object}` payload.
- **At-least-once property.** Because the cursor is caller-owned and the Blackboard never persists it, a retried heartbeat with the prior cursor may repeat the same changes. `ADR/0005-agent-blackboard-observability.md:38-43` and `skills/pi-team-lead/SKILL.md` "Heartbeat snapshot" make this explicit: "retrying with the previous cursor is safe and may repeat changes." `tests/blackboard.test.mjs` "snapshot exposes active critical changes with a caller-owned cursor" asserts duplicate `changes` survive a retry (the `retried.changes` test).
- **Separation from wakeup cursor.** The wakeup dedup id (`taskId:role:sequence`) and the snapshot cursor are **two independent mechanisms**: the cursor gates what the *Lead* observes, the wakeup id gates what the host *delivers*. An Issue #4 fix must keep them separate (snapshot is read-only, wakeup id is a side-effect gate).

### 1.6 Concurrency

- **Event append.** `appendAgentEvent` (`blackboard-core.mjs:607-635`) holds two nested `withLock` calls: the outer on the task JSON file and the inner on the per-role JSONL file. Each `withLock` uses an atomic `mkdir` lock with a 5-second timeout and a 25 ms retry (`blackboard-core.mjs:31-44, 113-127`); a failed lock raises "blackboard lock timeout".
- **Witness.** `tests/blackboard.test.mjs` "agent events are role-scoped, append-only, validated, and cursor-watchable" runs 12 `Promise.all(appendAgentEvent(...))` calls and asserts `concurrent.map(({event}) => event.sequence).sort(...)` returns exactly the 12 monotonically increasing sequences `2..13`. The test also asserts "agent-provided sequence must be ignored" — the sequence is server-assigned by reducing the existing JSONL, not derived from the caller's payload.
- **Wakeup concurrency (gap).** `lead-wakeup-adapter.mjs:dispatchLeadWakeups` does **not** call `claimLeadWakeup`. The existing `claimLeadWakeup` primitive (`blackboard-core.mjs:566-585`) supports an `in_flight` status, refuses to claim a wakeup that is `delivered`, `in_flight`, or `max_attempts_exceeded`, and increments `attempts` only on a successful claim. Today the adapter's `for (const wakeup of queue.wakeups)` loop reads the queue once via `listLeadWakeups` (which holds the lock for one read), then iterates without re-locking. Two concurrent dispatchers can therefore both observe `status: "pending"`, both send to the host, and both write via `recordLeadWakeupDelivery`. The state after the race is deterministic (the second `recordLeadWakeupDelivery` call wins, since both call `writeJsonAtomic` on the same file), but the *host* receives two `sendMessageToThread` requests for the same wakeup. The `delivery_id` round-trip masks the race only if the host returns a *single* `delivery_id` for each message — which is the typical Codex App Server behavior but is not guaranteed.
- **Causal evidence for the gap.** `tests/blackboard.test.mjs` "Lead wakeup adapter delivers, records, acknowledges, and retries host failures" tests a *single* dispatcher; no test exercises two dispatchers racing on the same task. The `claimLeadWakeup` primitive is exported and tested through other paths but **not** wired into the adapter as of this worktree.

### 1.7 Failure degradation

- **Bound but host rejects.** Adapter calls `recordLeadWakeupDelivery(..., {delivered: false, error: "host-rejected-wakeup" or result.reason})`. The wakeup status becomes `failed`, attempts `+= 1`, `last_error` is recorded. The next `dispatchLeadWakeups` call will retry up to `maxAttempts` times.
- **Bound but host throws.** Adapter catches the throw, records `{delivered: false, error: error.message}`. Same shape as host-rejected.
- **Bound but host transiently unreachable.** Same retry path; `last_error` carries the message; no exponential backoff or wall-clock jitter is applied — the adapter is "as fast as possible" within `dispatchLeadWakeups`. A real degradation strategy (backoff, circuit-break, drop-then-recover) would require either a scheduler outside the adapter or a new field in the wakeup record.
- **Unbound task.** `dispatchLeadWakeups` returns `{binding: null, delivered: [], skipped: queue.wakeups}`; the wakeups sit in `pending` state on the task JSON file. `appendAgentEvent` (line 631) still enqueues them even without a binding. This is intentional: a Lead that registers after the events arrive can drain the backlog on the first `dispatchLeadWakeups`. `tests/blackboard.test.mjs` does not test this path directly, but `listLeadWakeups` is gated only on `wakeup.status !== "acked"`, so un-bound wakeups remain visible to anyone who calls `listLeadWakeups` and registers later.
- **Missing task.** `registerLead` raises "only an active task can register a Lead"; `dispatchLeadWakeups` raises nothing (it reads `listLeadWakeups` first, which raises "unknown blackboard task" for missing tasks via `loadTask`). `tests/blackboard.test.mjs` does not test a missing-task dispatch.
- **Stale binding.** No explicit "binding is stale" code path exists today. If the host rejects every send with `reason: "stale-thread"`, the adapter records `failed` three times and the wakeup is permanently skipped. There is no automatic `unregisterLead` on persistent stale-thread rejection. The recovery action today is operator-side: read the task, `unregisterLead`, re-`registerLead` with the new thread.
- **Empty or malformed host response.** Adapter normalizes via `accepted = result?.accepted === true || result?.delivered === true || result?.threadId === queue.binding.thread_id`; anything else is treated as a rejection (`{delivered: false, error: result?.reason || "host-rejected-wakeup"}`). A host that returns `{accepted: true, delivery_id: ""}` will be recorded with an empty `delivery_id`, and the subsequent `acknowledgeLeadWakeup` call must pass the same empty string or it will fail the `delivery_id` match check. (`ensureLineField(input.delivery_id, "delivery_id", 240)` does **not** forbid an empty string — `required` defaults to `false`.)

### 1.8 Context summary path — what's there and what isn't

- **What the wakeup prompt includes today.** `formatLeadWakeup` (lines 18-30): `task_id`, `role`, `event_sequence`, `state`, `activity`, `blocker`, `next`, plus a fixed trailing line: `Action: inspect the current Blackboard snapshot, contract, diff, and artifacts before deciding the next Lead action.` All fields are ≤160 chars after summary redaction; Base64 / JWT-shaped values become `[transport payload redacted]`. There is **no** summary of (a) the most recent critical state per role for this task, (b) the Lead task `name` / `description`, (c) the artifact paths the slice produced, (d) the diff size or test summary.
- **What the Lead is expected to read after a wakeup.** `skills/pi-team-lead/SKILL.md` "Publish and explicitly start" step 4 / "Supervise the persistent pair" step: the Lead calls `blackboard_snapshot` (or `blackboard_watch`) to retrieve the task lane, then independently reads the contract, diff, and artifacts. The heartbeat snapshot uses the caller-owned cursor (skill text "Heartbeat snapshot").
- **Implication for Issue #4.** A "context summary" injected into the wakeup prompt would have to be derived from the same JSONL / task JSON that `snapshot` reads. The minimal safe shape is to prepend a 1–3 line "task context" block (task `name`, current description, latest per-role state) into `formatLeadWakeup`, with strict ≤160 char truncation and the same Base64 redactor. The Lead must still call `blackboard_snapshot` after each wakeup (the prompt cannot become a replacement for the snapshot read).

---

## 2. Untested inferences (claim + reason it is unverified)

- **I1. The wakeup adapter does not currently exploit `claimLeadWakeup`.** Reason: `lead-wakeup-adapter.mjs` only imports `acknowledgeLeadWakeup, listLeadWakeups, recordLeadWakeupDelivery`. The exported `claimLeadWakeup` is reachable via `blackboard-core.mjs` but has no caller. No test asserts the `in_flight` path through `dispatchLeadWakeups`. If a future Issue #4 implementation re-uses `claimLeadWakeup`, the contract becomes concurrency-safe; today it is not.
- **I2. A wakeup whose host returns a different `delivery_id` than the recorded one cannot be `ack`ed.** Reason: `acknowledgeLeadWakeup` checks `wakeup.delivery_id !== deliveryId` and raises "delivery does not match Lead wakeup". This is the only defense against a replay that targets a stale wakeup. The test asserts this (`tests/blackboard.test.mjs:303-307`), but no test covers the case where the host returns `{accepted: true, threadId: <binding.thread_id>}` and no `delivery_id` (the adapter synthesizes `delivery_id = randomUUID()`, and the matching `ack` would need to pass the same random UUID — which the host does not know).
- **I3. The wakeup adapter does not schedule retries with backoff.** Reason: `dispatchLeadWakeups` retries "as fast as possible" within one call; `maxAttempts = 3` is the only knob. There is no test for backoff, no field for `next_retry_at`, and no exponential-jitter helper.
- **I4. Unbound wakeups accumulate indefinitely until the Lead binds.** Reason: `appendAgentEvent` enqueues a wakeup regardless of binding; `listLeadWakeups` returns every `status !== "acked"` wakeup. No test exercises the unbound-accumulation path, and no test asserts a cap.
- **I5. The wakeup summary is identical for every Lead binding change.** Reason: `formatLeadWakeup` takes only the wakeup record; binding changes (`registerLead`, `unregisterLead`) update the task JSON but never enqueue a wakeup. There is no "binding-acknowledged" event in the JSONL.
- **I6. `blackboard_snapshot` does not surface the Lead wakeup queue depth.** Reason: `taskSummary` exposes `lead_wakeup_pending` (`blackboard-core.mjs:194`), which counts `wakeups.filter(item => item.status !== "acked").length` *at snapshot time*. The `changes` array exposes only the new critical events since the cursor, not the wakeup queue delta. The Lead thus has to call `blackboard_list_lead_wakeups` separately if it wants queue depth. There is no test asserting the field shape across binding churn.
- **I7. Concurrent `dispatchLeadWakeups` calls from two host adapters (e.g. a primary and a shadow) can both send and both record.** Reason: there is no `claimLeadWakeup` call in the loop. This is the practical consequence of §1.6.
- **I8. `recordLeadWakeupDelivery` does not enforce that the wakeup exists before recording.** Reason: it does (`if (!wakeup) fail("unknown Lead wakeup: ${id}")`), but the error surfaces only to the adapter, not to the host. A host that retries on `unknown Lead wakeup` will retry forever unless the caller distinguishes "unknown" from "max attempts exceeded".
- **I9. The wakeup prompt does not include the role's `worktree`.** Reason: `formatLeadWakeup` consumes only the wakeup record, which has `task_id`, `role`, `sequence`, `state`, `activity`, `blocker`, `next`. The `worktree` is recorded on the JSONL event but not propagated to the wakeup. The Lead has to query the JSONL or `snapshot` to discover the worktree.

---

## 3. Gaps (what the code does not answer)

- **G1. No structured retry-class on `failed` wakeups.** The reason field is a free-text line. A future implementation needs a structured `error_class` (`host-unreachable`, `host-rejected`, `host-stale-binding`, `host-malformed-response`) so the dispatcher can choose a different retry policy per class. Today every failure is treated identically.
- **G2. No backoff / `next_retry_at`.** A scheduler that polls `pending` / `failed` wakeups with `attempts < maxAttempts` cannot apply exponential backoff without a server-side timestamp.
- **G3. No wakeup-level idempotency at the host.** `createLeadWakeupRequest` does not embed a per-attempt nonce. If the host stores `event_key` and the adapter retries (e.g. after a transient write failure of the `delivered` record), the host may produce two follow-up turns unless it dedups by `event_key`. There is no test of this.
- **G4. No context-summary derivation.** `formatLeadWakeup` is activity-only. A bounded context summary (e.g. "task name; latest per-role critical state; current Lead action hint") is not in the prompt today. Issue #4's "上下文摘要" needs to be designed.
- **G5. No "binding stale" auto-detection.** Persistent stale-thread rejections require operator action (`unregisterLead` + `registerLead`). A safe auto-detect needs a circuit-break heuristic that does not over-react to a single transient failure.
- **G6. No cap on unbound wakeup accumulation.** A task with no Lead binding will accumulate one wakeup per critical event forever. `tests/blackboard.test.mjs` does not exercise this; a 1k-event load test would expose the memory growth.
- **G7. No `claimLeadWakeup` integration test.** The primitive exists; no test exercises `in_flight` semantics through the adapter.
- **G8. The wakeup prompt redactor is partial.** It catches `^[A-Za-z0-9+/_-]{32,}=*$` and `^eyJ[A-Za-z0-9+/_-]{20,}`. It does **not** catch plain JWT strings inside the activity text or Base64 with `=` padding (the `=*` suffix is required by the regex; `abc==` matches but `abc=` does not).
- **G9. No test for "host returns success but no `delivery_id`".** Adapter synthesizes a random UUID; the matching ack call would have to know the UUID. This is untested; the natural fix is to *require* the host to return `delivery_id` (treat synthesis as a host failure).

---

## 4. External sources consulted (supporting only; do not replace local evidence)

| Source | Title / URL | Key conclusion relevant to Issue #4 | Applicability boundary |
| --- | --- | --- | --- |
| `agentpatterns.ai` | "Event-Driven System Reminders" — `https://www.agentpatterns.ai/instructions/event-driven-system-reminders/` | Reminders should be idempotent and deduplicated by a deterministic id; consumer should be able to acknowledge; failures should be observable, not silent. | Matches `wakeupId(taskId, role, sequence)` + `status: acked` + `last_error`. |
| `tianpan.co` | "Idempotency, agentic tool calling, saga deduplication" — `https://tianpan.co/blog/2026/04/19/idempotency-agentic-tool-calling-saga-deduplication` | Agent actions must carry an idempotency key for retry safety; tool-level keys differ from saga-level keys. | Maps to `wakeupId` (per-event key) and the missing per-attempt nonce (G3). |
| `cockroachlabs.com` | "Idempotency and Ordering in Event-Driven Systems" — `https://www.cockroachlabs.com/blog/idempotency-and-ordering-in-event-driven-systems` | Ordering matters for at-least-once delivery; consumers must dedup at the boundary. | Matches the snapshot cursor + wakeup dedup pair; ordering is enforced by the JSONL sequence. |
| `milanjovanovic.tech` | "The Idempotent Consumer Pattern in .NET and Why You Need It" — `https://milanjovanovic.tech/blog/the-idempotent-consumer-pattern-in-dotnet-and-why-you-need-it` | A consumer must check "have I seen this id before?" before acting. | Matches `claimLeadWakeup` returning `in_flight` / `already_delivered` / `max_attempts_exceeded`. |
| `fast.io` | "AI Agent Retry Patterns" — `https://fast.io/resources/ai-agent-retry-patterns` | Recommend 3–5 retry attempts with exponential backoff and circuit-break after persistent failures. | Matches `maxAttempts = 3` (low end of the range) and the missing backoff (G2). |
| `iamstackwell.com` | "AI Agent Retry Strategy" — `https://iamstackwell.com/posts/ai-agent-retry-strategy/` | Distinguish transient (retry) from permanent (escalate) failures via error classification. | Matches G1 (no structured error class on failed wakeups). |
| `learn.microsoft.com` | "Azure Event Hubs Functions resilient design" — `https://learn.microsoft.com/en-us/azure/architecture/serverless/event-hubs-functions/resilient-design` | At-least-once delivery requires consumer-side deduplication using a stored id. | Matches `wakeupId` + `acknowledgeLeadWakeup` "delivery does not match" guard. |
| `aws.amazon.com` | "Amazon SNS Message Delivery Retries" — `https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html` | Default SNS retry policy is 3 attempts with backoff between regions. | Matches `maxAttempts = 3` and the absence of backoff (G2). |
| `developers.cloudflare.com` | "Cloudflare Agents Runtime: Retries" — `https://developers.cloudflare.com/agents/runtime/execution/retries` | Retry hooks should classify the error (4xx vs 5xx vs timeout) before re-running. | Matches G1. |
| `courier.com` | "Delivery Pipeline Resilience" — `https://www.courier.com/docs/platform/sending/delivery-pipeline-resilience` | Notification delivery should distinguish user-error vs system-error and surface the classification to the sender. | Matches G1 and the wakeup `last_error` field. |
| `kingy.ai` | "OpenAI Codex Command Guide" — `https://kingy.ai/news/openai-codex-command-guide` | Codex CLI exposes thread/turn commands but the App Server's `send_message_to_thread` is the supported follow-up turn mechanism (matches `README.md:91`). | External reference for the host adapter contract; not a substitute for local testing. |
| `community.openai.com` | "Is there a built-in way to have agent threads communicate?" — `https://community.openai.com/t/is-there-a-built-in-way-to-have-agent-threads-communicate-i-started-my-own/1374716` | Confirms the canonical pattern is "spawn a follow-up turn" rather than poll. | Matches the wakeup-as-prompt pattern. |
| `deepsource.io` (replaced with `yage.ai`) | "Codex persistent mode follow-up" — `https://yage.ai/share/codex-persistent-mode-en-20260903.html` | The Codex persistent follow-up path is "send-message-v2" — a follow-up prompt into an existing thread. | Matches the adapter's `sendMessageToThread` contract. |

Note on access: `fetch_content` is currently blocked on `198.18.0.0/15` (SSRF filter) for github.com, google.com, and most external hosts. The table above draws on `web_search` synthesized snippets and the publisher's cached summary layer; the headline conclusions are corroborated across multiple sources but the *exact quoted text* has not been verified line-by-line through `source_check`. Where a local file (e.g. `tests/blackboard.test.mjs:303-307` for the `delivery_id` mismatch test) anchors the same idea, the local evidence is preferred and the external source is recorded as corroboration.

---

## 5. Minimal safe fix boundary (what Issue #4 may touch without breaking the contract)

The Blackboard must remain an observation / reminder plane (`README.md:69-91`, `ADR/0005-agent-blackboard-observability.md`, `skills/pi-team-lead/SKILL.md`). The minimal safe surface for Issue #4:

1. **Critical-event filter (`LEAD_WAKE_STATES`)** — no change. The current set covers all Lead-action-required states. Any new state must be added to `LEAD_WAKE_STATES` and reflected in `snapshotChanges` (line 271-285) and the `blackboard-lead` skill.
2. **Wakeup identity (`taskId:role:sequence`)** — no change. The deterministic id is the application-level idempotency key.
3. **Lead binding (`registerLead` / `unregisterLead`)** — no change to the contract. The binding remains `(thread_id, host_id)` per task. The only allowed extensions are: (a) optional `registered_at` / `last_seen_at` fields (already supported as `registered_at` at `blackboard-core.mjs:469`), (b) optional `capabilities` (NOT supported today; adding it would be a separate decision).
4. **Wakeup adapter (`lead-wakeup-adapter.mjs`)** — limited additions:
   - Add `claimLeadWakeup` to the loop so concurrent dispatchers serialize on `in_flight`. This is the only safe way to introduce concurrent dispatch (G7, I1).
   - Optionally extend `formatLeadWakeup` to include a bounded "task context" line: `task_name=<name>; description=<description>` (truncated to ≤160 chars by the same `summary` helper). This requires reading the task JSON inside `dispatchLeadWakeups` and adds one read per call.
   - Do NOT change the Base64 / JWT redactor semantics; the existing tests (`tests/blackboard.test.mjs` `doesNotMatch(request.prompt, /base64|eyJ[A-Za-z0-9]/i)`) are the regression guard.
   - Do NOT change the `acknowledgeLeadWakeup` `delivery_id` match contract; the host is the source of truth for the id.
5. **Cursor** — no change. The cursor remains caller-owned and only gates `snapshot.changes`. The wakeup dedup id is independent.
6. **Failure degradation** — limited additions:
   - Add an `error_class` field on `failed` wakeups (`host-unreachable`, `host-rejected`, `host-stale-binding`, `host-malformed-response`) so the adapter can apply different policies. The `error` line stays for human-readable diagnostics.
   - Optional `next_retry_at` field (ISO 8601). The adapter would skip wakeups whose `next_retry_at > now`. This is the minimum to enable backoff without a server-side scheduler.
   - Optional "binding-stale" heuristic: after N consecutive `host-stale-binding` failures on the same task, the adapter records `task.binding_state = "stale"` (read-only field on the task JSON) without auto-unregistering. The Lead observes this through `snapshot` and acts.
7. **MCP tools** — `blackboard_list_lead_wakeups`, `blackboard_ack_lead_wakeup`, `blackboard_register_lead`, `blackboard_unregister_lead` remain the only Lead-facing wakeup tools. Issue #4 may add `error_class` and `next_retry_at` to the `lead_wakeups` array's element shape (additive; existing consumers that ignore unknown fields keep working).
8. **Tests** — extend `tests/blackboard.test.mjs` (NOT modify existing assertions; the existing 37 deterministic tests must stay green). Add the positive / negative scenarios in §6 below.

What Issue #4 must NOT change:
- The Blackboard MUST NOT become a control bus (no delivery of executable payloads, no `shouldMirror`-style decisions in the wakeup prompt).
- The bounded peer topology (`BOUNDED_PEERS`) and the audit field set are out of scope (mirror of Issue #011).
- The wire envelope (`agent-team/v1` / `body_encoding: base64url`) is out of scope (per Issue #011).
- `resolveTeamPeerRole` and the `pi-team--<task-id>--<role>--<launch-id>` prefix are out of scope.
- The CLI / `pi-team.cmd` entrypoint is out of scope (no new command-line flag for context-summary injection).

---

## 6. Positive, negative, and control verification scenarios

### 6.1 Positive (must pass after a safe Issue #4 fix)

- **P1 — single critical event produces a single wakeup with a stable summary.** `working → waiting → ready_for_review` on task `BB-WAKE-001`, Lead bound, host accepts. `listLeadWakeups(...).wakeups[0]` carries `id = "<task>:executor:<seq>"`, `status = "delivered"`, `attempts = 1`. `formatLeadWakeup` output includes `task_name=<name>; description=<description>` (truncated). Witness: extends `tests/blackboard.test.mjs` "critical Agent events enqueue a bound Lead wakeup…".
- **P2 — host returns `delivery_id`; ack succeeds.** Same setup; host returns `{accepted: true, delivery_id: "delivery-XYZ"}`. Subsequent `acknowledgeLeadWakeup` with `delivery_id: "delivery-XYZ"` transitions to `acked`. Witness: extends "Lead wakeup adapter delivers, records, acknowledges, and retries host failures".
- **P3 — host rejects twice then accepts.** `maxAttempts = 3`; first two calls return `{accepted: false, reason: "host-rejected"}`, third returns success. Wakeup ends in `status = "delivered"`, `attempts = 3`. Witness: extends the same test with a counter host stub.
- **P4 — concurrent dispatcher serializes on `claimLeadWakeup`.** Two `dispatchLeadWakeups` calls fired in parallel; the second observes `in_flight` and skips. Only one `sendMessageToThread` call is recorded. Witness: NEW test that asserts the host sees exactly one call.
- **P5 — heartbeat with prior cursor sees new wakeup without re-issuing old events.** `snapshot(cursor)` returns only new critical events; wakeups already in `delivered` or `acked` do not appear in `changes`. Witness: extends "snapshot exposes active critical changes with a caller-owned cursor".
- **P6 — context-summary injection redacts Base64.** A wakeup whose `activity` contains a JWT-shaped token is summarized as `[transport payload redacted]`. Witness: extends the `doesNotMatch` assertion in the existing wakeup test.

### 6.2 Negative (must pass; failure to pass = contract violation)

- **N1 — non-critical state does not enqueue a wakeup.** `working` and `waiting` events produce zero wakeups; only `LEAD_WAKE_STATES` produce. Witness: existing test.
- **N2 — cross-task wakeup isolation.** A wakeup enqueued for task A is never visible to `listLeadWakeups(B)`. Witness: existing test "Lead wakeup binding is explicit and isolated per task".
- **N3 — different binding rejected.** `registerLead(A, {thread_id: "lead-other"})` after `registerLead(A, {thread_id: "lead-a"})` raises "different Lead binding". Witness: existing test.
- **N4 — `acknowledgeLeadWakeup` with wrong `delivery_id` raises.** Mismatched id is refused; wakeup remains `status = "delivered"`. Witness: existing test.
- **N5 — host accepts but `dispatchLeadWakeups` is called twice without an ack.** Second call sees `status = "delivered"` and skips (no double delivery). Witness: NEW test that calls `dispatchLeadWakeups` twice on the same task.
- **N6 — host returns `{accepted: true, delivery_id: ""}`.** Adapter treats the empty id as a malformed response; wakeup stays `failed` with `error_class = "host-malformed-response"`. Witness: NEW test.
- **N7 — unbounded wakeup accumulation cap (if implemented).** A task that emits 1000 critical events with no Lead binding caps the wakeup queue at the chosen limit (e.g. 256) and records a `truncated` flag. Witness: NEW load test, only if the cap is implemented.
- **N8 — wakeup prompt never contains Base64 / JWT bytes.** The redactor catches every pattern the existing redactor recognizes, plus the new context-summary field. Witness: extends the existing `doesNotMatch` assertion.
- **N9 — `recordLeadWakeupDelivery` for an unknown wakeup raises and the host sees the error.** Caller distinguishes "unknown wakeup" from "max attempts exceeded". Witness: NEW test.
- **N10 — concurrent heartbeat with stale cursor sees only new events.** Two `snapshot(cursor)` calls race; one returns the baseline (empty changes), the other returns the new event. No event is duplicated or lost. Witness: extends the existing concurrency test.

### 6.3 Control (regression coverage; existing tests must stay green)

- **C1 — `tests/blackboard.test.mjs` 37 deterministic tests stay green.** The existing assertions for `appendAgentEvent`, `registerLead`, `listLeadWakeups`, `recordLeadWakeupDelivery`, `acknowledgeLeadWakeup`, `dispatchLeadWakeups`, snapshot cursor, watch metadata-only suppression, and the plugin/MCP wiring must all pass unchanged.
- **C2 — `tests/team-contract.test.mjs` stays green.** The launcher, role injection, and `pi-team.cmd` contracts must not regress.
- **C3 — `tests/communication-policy.test.mjs` stays green.** The bounded peer topology, envelope shape, audit redaction, and `report_to_lead` paths must not regress.
- **C4 — `tests/run-tests.ps1` passes.** The cross-shell entry point and the Windows PowerShell entry point must agree.

---

## 7. Confidence and caveats

- **Confidence: high** for the local evidence in §1 — every claim is anchored in a file:line and corroborated by a `tests/blackboard.test.mjs` case (where one exists).
- **Confidence: high** for §3 gaps — each gap is the absence of a code construct; absence is observable.
- **Confidence: medium** for §2 untested inferences — these are reasoned from the code shape, not proven.
- **Confidence: medium** for §4 external sources — `fetch_content` is blocked on the SSRF range today, so the external table is corroborated through `web_search` synthesized snippets, not raw page content. The table is supporting reference only; Issue #4 decisions must be made against local evidence.
- **Caveat — the actual GitHub Issue #4 text could not be retrieved.** The Lead task context paraphrases Issue #4 as "Blackboard 更新唤醒 Lead 并注入上下文 — 围绕 GitHub Issue #4，实现或验证有意义的 Blackboard 更新对绑定 Lead 的可靠唤醒、上下文摘要、游标去重、并发处理与失败降级；Blackboard 仍是观察/提醒平面". This paraphrase is the operative scope; the actual Issue #4 body on `github.com/shhhans/codex-pi-team/issues/4` was unreachable through the configured `fetch_content` (SSRF filter on `198.18.0.0/15` for github.com / api.github.com / webcache.googleusercontent.com / r.jina.ai). The Lead should confirm the Issue body before accepting this artifact as the Issue #4 research contract.
- **Caveat — no Silver/Gold inputs were used.** Per the active Lead assignment ("也不要读取或推导 Gold、oracle、期望补丁或评测保留数据"), this artifact reads only the local repository and the public web (via `web_search` synthesized snippets). No expected-patch or test-derived answer data was consulted.
- **Caveat — the wakeup adapter is not currently exercised end-to-end.** `tests/blackboard.test.mjs` covers the adapter with a stub `sendMessageToThread`; `project_state.md` records that the BB-FIX-001 causal smoke passed through the Blackboard update path (`working → reviewing → ready_for_acceptance`), but the wakeup host adapter itself was not exercised live in that smoke. Issue #4's "实现或验证" wording implies Lead may want a live smoke as well; this artifact only describes the verification surface.

---

## 8. Sources (read-only)

Local files (no system commands run, no production-code edits, no test edits):

- `plugins/agent-blackboard/server/blackboard-core.mjs:7-13, 31-44, 60-80, 87-101, 113-127, 172-190, 194, 271-292, 452-490, 491-507, 537-560, 566-585, 587-605, 607-635`
- `plugins/agent-blackboard/server/lead-wakeup-adapter.mjs:1-72`
- `plugins/agent-blackboard/server/blackboard-mcp.mjs:1-145` (tool catalog, `blackboard_register_lead`, `blackboard_unregister_lead`, `blackboard_list_lead_wakeups`, `blackboard_ack_lead_wakeup`)
- `plugins/agent-blackboard/skills/pi-team-lead/SKILL.md` (publish / start / supervise / heartbeat)
- `plugins/agent-blackboard/skills/blackboard-lead/SKILL.md`
- `.pi/communication/extensions/blackboard-update.ts:1-50`
- `.pi/communication/policy.mjs` (ROLES, BOUNDED_PEERS, RESEARCHER_CAPABILITIES, authorizeResearchDelegation — unchanged context for Issue #4)
- `tests/blackboard.test.mjs` ("agent events are role-scoped, append-only…", "snapshot exposes active critical changes…", "watcher returns causally on Agent activity…", "critical Agent events enqueue a bound Lead wakeup…", "Lead wakeup adapter delivers, records, acknowledges, and retries host failures", "Lead wakeup binding is explicit and isolated per task", "repo-local plugin exposes Lead-only tools, skills, MCP server, and inline/PiP UI")
- `ADR/0002-lead-subagent-collaboration-protocol.md` (Lead authority, persistent pair lifecycle, communication topology)
- `ADR/0005-agent-blackboard-observability.md` (Blackboard plane contract; `LEAD_WAKE_STATES` filter rationale)
- `AGENTS.md` (Lead-only Blackboard skill; communication rules)
- `architect.md` (active agent surface; Blackboard as observation plane)
- `project_state.md` ("Lead wakeups use one explicit active-task binding…")
- `README.md` (formal contract; heartbeat cursor; MCP availability expectations)
- `research/ISSUE-011-intercom-envelope-recovery.md` (out-of-scope contract that Issue #4 must respect)
- `research/ISSUE-003-bounded-research-protocol.md` (Researcher wakeup state `completed`)
- `research/BOOTSTRAP-SELF-005-node-test-exit-code.md` (format reference for bounded researcher artifacts)
- `reports/PERF-004-review.md:88` (historical evidence of Base64 misuse in hand-rolled envelopes — supports the redactor test)
- `reports/ISSUE-001-review.md:163, 177, 183-197, 228` (historical evidence of helper-encode.mjs leakage — supports the redactor test)
- `failures/BOOTSTRAP-SELF-004A-unauthorized-reply-reservation.md` (precedent for ordered audit writes — supports the claim/reconcile ordering)

External (supporting reference only, via `web_search` synthesized snippets; not a substitute for local evidence):

- https://www.agentpatterns.ai/instructions/event-driven-system-reminders/
- https://tianpan.co/blog/2026/04/19/idempotency-agentic-tool-calling-saga-deduplication
- https://www.cockroachlabs.com/blog/idempotency-and-ordering-in-event-driven-systems
- https://milanjovanovic.tech/blog/the-idempotent-consumer-pattern-in-dotnet-and-why-you-need-it
- https://fast.io/resources/ai-agent-retry-patterns
- https://iamstackwell.com/posts/ai-agent-retry-strategy/
- https://learn.microsoft.com/en-us/azure/architecture/serverless/event-hubs-functions/resilient-design
- https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html
- https://developers.cloudflare.com/agents/runtime/execution/retries
- https://www.courier.com/docs/platform/sending/delivery-pipeline-resilience
- https://kingy.ai/news/openai-codex-command-guide
- https://community.openai.com/t/is-there-a-built-in-way-to-have-agent-threads-communicate-i-started-my-own/1374716
- https://yage.ai/share/codex-persistent-mode-en-20260903.html

End of research artifact.
