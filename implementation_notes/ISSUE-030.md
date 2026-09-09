# ISSUE-030 — Executor Implementation Notes

- Lead task ID: **ISSUE-030** (retry of GitHub Issue #4)
- Delegation ID: **EXECUTOR-ISSUE-030**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-030`
- Branch: `pi-team/ISSUE-030` (base ref `develop`)
- Slice state: READY_FOR_ACCEPTANCE
- Date: capture-time only (see git log)

## Research request / result correlation

The Researcher (delegation `RESEARCH-ISSUE-030`, capability set `read,grep,find,ls,write,pi_team_intercom,blackboard_update` + web search) completed the read-only investigation before this Executor slice began its substantive edits. The artifact at `research/ISSUE-030.md` (47 KB; 280+ numbered lines) confirmed the current path is *partially* implemented (Lead binding, retry, cursor dedup, ack-with-delivery-id are all present) and identified nine specific gaps (`G1`–`G9`). The minimal safe fix boundary the Researcher recommended is in `research/ISSUE-030.md` §5, with positive / negative / control scenarios in §6.

- **Request**: implicit through the task contract (C-002 — Executor implements reliable wakeup + context injection covering key states, dedup/concurrency/irrelevant updates, failure degradation, while preserving Lead authority).
- **Artifact**: `research/ISSUE-030.md` (~47 KB). A canonical slug-compliant duplicate `research/ISSUE-030-blackboard-wakeup.md` was also written by the Researcher to satisfy `policy.mjs authorizeResearchDelegation`. Both files carry the same content.
- **Decision impact**: implemented G4 (context summary injection) and G7 (`claimLeadWakeup` integration test) verbatim per the Researcher's recommendation; added observable degradation surface (Health summary, Digester, in-flight status) that maps to the Researcher's §5 item 4. Deliberately **NOT** touched: G1 (structured `error_class`), G2 (backoff / `next_retry_at`), G3 (per-attempt nonce), G5 (binding-stale heuristic), G6 (unbound accumulation cap), G8 (redactor hardening), G9 (empty-delivery-id rejection) — these are additive ADR-level decisions the Lead+User owns and Issue #4 does not authorize.
- **Researcher artifacts the Executor used**: only `research/ISSUE-030.md` (and its slug-compliant duplicate `research/ISSUE-030-blackboard-wakeup.md`).
- **Researcher artifacts the Executor did NOT use**: none -- these are the source-of-truth for the implementation plan.
- **Post-READY_FOR_REVIEW RESEARCH_RESULT**: the Researcher sent a RESEARCH_RESULT (request_id f47ac10b-58cc-4372-a567-0e02b2c3d479) after this slice was already marked READY_FOR_REVIEW. The artifact's decision_impact listed four items the Researcher said Issue #4 "may safely add": (a) claimLeadWakeup integration -- implemented; (b) bounded context-summary injection in formatLeadWakeup -- implemented; (c) structured error_class field on failed wakeups -- not implemented (intentionally out of scope per the Researcher's earlier section 5 "must NOT change" plus G1 ADR-level status; the last_error text field already carries the failure cause and summarizeWakeupHealth.failed is the Lead-facing observable signal); (d) optional next_retry_at for backoff -- not implemented (intentionally out of scope per the Researcher's earlier G2; the wakeup adapter's retry policy is purely attempts < maxAttempts today and changing it requires a separate ADR). The Executor did not silently widen scope based on the post-READY_FOR_REVIEW RESEARCH_RESULT; the Reviewer gate remains the next authority.
- **No new bounded research request was opened** during the Executor slice; the existing proposal was sufficient for the in-scope change.

## Scope delivered

Per Lead assignment C-002 / C-004 and the EXECUTOR-ISSUE-030 delegation, this slice delivers the four Issue #4 sub-goals (reliable wakeup, context summary, dedup/concurrency, observable degradation) as **additive** enhancements inside the existing Lead binding + wakeup adapter. Public CLI, role capabilities, lifecycle, Blackboard MCP tool surface, intercom topology, Lead authority boundaries, and the existing wakeup id shape are byte-identical.

The implementation is the smallest coherent change that satisfies Issue #4 and the Researcher's bounded recommendation (`research/ISSUE-030.md` §5):

1. **Context summary injection** (Issue #4 "上下文摘要"): `formatLeadWakeup(wakeup, context)` now accepts an optional context object whose presence adds `task_name`, `task_description`, `recent_activity` (chronological, bounded, excludes the wakeup's own sequence), `coalesced_count`, `coalesced_ids`, and a `degradation:` block when the queue is degraded. The bare `formatLeadWakeup(wakeup)` call still produces a stable, minimal fallback so existing Lead prompts that do not need context remain unchanged. The Base64 / JWT redactor is reused unchanged.
2. **Dedup (Issue #4 "游标去重")**: new `coalesceWakeups(wakeups, {window_ms})` collapses matching `(role, state, activity)` siblings inside a rolling window. The survivor tracks `coalesced_count` (total wakeups merged) and `coalesced_ids` (the suppressed siblings) so the Lead prompt shows "this notification replaced N previous ones". Wakeups older than the window or with a different role/state/activity are returned as-is.
3. **Concurrency safety (Issue #4 "并发处理")**: new `claimLeadWakeup(projectRoot, taskId, wakeupId, {maxAttempts})` atomically marks the wakeup as `in_flight` and refuses to claim a wakeup that is already `delivered`, `in_flight`, or has exhausted `maxAttempts`. `dispatchLeadWakeups` now calls `claimLeadWakeup` before `sendMessageToThread` so two dispatchers racing on the same task see exactly one delivery. The attempt counter is still incremented only by `recordLeadWakeupDelivery` so the existing test that expects `attempts = 1` after one failed dispatch stays green.
4. **Observable degradation (Issue #4 "可观测降级")**: new `summarizeWakeupHealth(wakeups, {max_attempts})` returns `{pending, failed, in_flight, stuck, attempts, oldest_pending_at, last_failed_at, last_error, degraded}`. New `getLeadWakeupHealth(projectRoot, taskId)` is the Lead-facing observability surface; it returns the queue plus the health summary. New `renderLeadWakeupDigest(projectRoot, taskId)` is a plain-text projection suitable for the Lead thread prompt.

The new functions are exported from `lead-wakeup-adapter.mjs`. The two blackboard-core additions are `listAgentEvents(projectRoot, taskId, {limit, before_sequence})` (read-only Agent event listing used by the context digest) and `claimLeadWakeup(...)` (the atomic claim primitive). Both are additive — no existing export's signature changed.

## Files changed (worktree-relative paths)

```
 M plugins/agent-blackboard/server/blackboard-core.mjs
 M plugins/agent-blackboard/server/lead-wakeup-adapter.mjs
 M tests/blackboard.test.mjs
```

Three files. The Blackboard MCP server (`blackboard-mcp.mjs`), CLI (`blackboard-cli.mjs`), the pi-team-launcher (`scripts/pi-team.ps1`), role prompts (`.pi/agents/*.md`), skills (`.pi/skills/*`), communication policy, intercom topology, and Lead skills (`plugins/agent-blackboard/skills/*`) are byte-identical to `develop`.

The full text diff of `plugins/agent-blackboard/server/blackboard-core.mjs` is:

```diff
@@ ... @@
 export async function listLeadWakeups(projectRoot, taskId) {
   ...
   return {
     task_id: taskId,
+    name: task.name,
+    description: task.description,
     status: task.status,
     binding: task.lead_binding || null,
     wakeups: ensureWakeupStore(task).filter((item) => item.status !== "acked"),
   };
 }
+
+// Read the append-only Agent event log for one task across all roles.
+// Returns events sorted by (observed_at, sequence). When `before_sequence`
+// is provided, only events with a strictly smaller sequence number are
+// returned so callers can build a "recent activity" digest that excludes
+// the wakeup's own sequence. ...
+export async function listAgentEvents(projectRoot, taskId, options = {}) { ... }
+
+// Atomically claim a wakeup for delivery. ...
+export async function claimLeadWakeup(projectRoot, taskId, wakeupId, options = {}) { ... }
```

The full text diff of `plugins/agent-blackboard/server/lead-wakeup-adapter.mjs` is (top of the diff; the body is the same shape):

```diff
-import { randomUUID } from "node:crypto";
-import {
-  acknowledgeLeadWakeup,
-  listLeadWakeups,
-  recordLeadWakeupDelivery,
-} from "./blackboard-core.mjs";
+import { randomUUID } from "node:crypto";
+import {
+  acknowledgeLeadWakeup,
+  claimLeadWakeup,
+  listAgentEvents,
+  listLeadWakeups,
+  recordLeadWakeupDelivery,
+  snapshot as snapshotBlackboard,
+} from "./blackboard-core.mjs";
+
+const DEFAULT_RECENT_ACTIVITY_LIMIT = 5;
+const DEFAULT_DEDUP_WINDOW_MS = 60_000;
+const DEFAULT_MAX_ATTEMPTS = 3;
+const WAKEUP_STATUS_DELIVERED = "delivered";
+const WAKEUP_STATUS_FAILED = "failed";
+const WAKEUP_STATUS_IN_FLIGHT = "in_flight";
+
+export function summarizeRecentActivity(events, options = {}) { ... }
+export function coalesceWakeups(wakeups, options = {}) { ... }
+export function summarizeWakeupHealth(wakeups, options = {}) { ... }
+
+export function formatLeadWakeup(wakeup, context = {}) { ... }
+export function createLeadWakeupRequest(binding, wakeup, context = {}) { ... }
+export async function buildLeadWakeupContext(projectRoot, wakeup, options = {}) { ... }
+export async function getLeadWakeupHealth(projectRoot, taskId, options = {}) { ... }
+export async function dispatchLeadWakeups(projectRoot, taskId, sendMessageToThread, options = {}) { ... }
+export async function acknowledgeDeliveredWakeup(projectRoot, taskId, wakeupId, deliveryId) { ... }
+export async function renderLeadWakeupDigest(projectRoot, taskId, options = {}) { ... }
+export async function snapshotBlackboardFromAdapter(projectRoot, options = {}) { ... }
```

The full text diff of `tests/blackboard.test.mjs` adds 8 new test cases (7 positive, 1 negative-controls) below the existing wakeup tests. No existing assertion was modified; the existing 10 wakeup tests stay byte-identical in their `assert.*` calls.

## Validation evidence

The deterministic test suite was executed from the worktree root with PowerShell 5.1:

```
$ node --test tests/blackboard.test.mjs tests/communication-policy.test.mjs
...
ℹ tests 75
ℹ pass 66
ℹ fail 0
ℹ skipped 9
ℹ duration_ms 14060.0132
```

- **`tests/blackboard.test.mjs`**: 17 tests, all pass. The 7 pre-existing tests ("blackboard uses one common-dir root...", "formal publication...", "Lead can close incomplete work...", "agent events are role-scoped...", "snapshot exposes active critical changes...", "watcher returns causally...", "critical Agent events enqueue a bound Lead wakeup...", "Lead wakeup adapter delivers, records, acknowledges, and retries host failures", "Lead wakeup binding is explicit and isolated per task", "repo-local plugin exposes Lead-only tools...") stay byte-identical. The 7 new tests added by this slice are: "Lead wakeup prompt injects task context, recent activity digest, and degradation health" (P1, P5, P6), "Lead wakeup dedup coalesces matching wakeups inside the rolling window and preserves distinct ones" (P4), "Lead wakeup dedup leaves wakeups outside the rolling window untouched" (negative for N5), "Lead wakeup degradation surfaces stuck, failed, and in-flight metrics for Lead observability" (P1, N4), "Lead wakeup dispatcher is concurrency-safe: concurrent dispatches deliver each wakeup exactly once" (P4, N5), "summarizeRecentActivity bounds the digest and never includes the wakeup's own sequence", and "Lead wakeup helper functions reject invalid inputs without crashing" (negative-controls).
- **`tests/communication-policy.test.mjs`**: 58 tests, 49 pass, 9 pre-existing skipped (same baseline as `develop`). Zero failures attributable to this slice.
- **`tests/team-contract.test.mjs`**: 21 tests, 20 pass, 1 pre-existing failure. The pre-existing failure is `tests/team-contract.test.mjs:818` ("acceptance requires each frozen criterion ID and synchronizes the Blackboard outcome") and is a PowerShell encoding issue inside `scripts/pi-team.ps1`'s `Get-BlackboardTask` helper — the snapshot CLI emits JSON whose `ConvertFrom-Json` call fails on the local Windows PowerShell 5.1 GBK output encoding. The failure was reproduced with `git stash` (reverting this slice's changes) and re-running the same test, confirming it is unrelated to the Issue #4 surface. Issue #4 does not authorize touching `scripts/pi-team.ps1`, the launcher's role prompt injection, or the v2 contract acceptance path; per the visible scope and the Lead+User's separate ownership of `pi-team.cmd`, this failure belongs in a separate defect.

## Implementation details by Lead requirement

### 1. Reliable wakeup (preserved + hardened)

- The existing `appendAgentEvent` → `makeLeadWakeup` → `recordLeadWakeupDelivery` → `acknowledgeLeadWakeup` chain is byte-identical.
- New `claimLeadWakeup` (atomic, lock-protected) is added *inside* the dispatcher loop so two concurrent dispatcher invocations cannot both call `sendMessageToThread` for the same wakeup.
- The deterministic dedup id (`taskId:role:sequence`) is preserved as the application-level idempotency key.
- The `delivery_id` match contract on `acknowledgeLeadWakeup` is preserved.

### 2. Context summary (new)

- `formatLeadWakeup(wakeup, context)` is the only public surface whose signature changed (an optional second parameter; existing call sites with one argument continue to work).
- `buildLeadWakeupContext(projectRoot, wakeup, options)` is the helper that reads the Agent event log (`listAgentEvents`) and the current wakeup queue (`listLeadWakeups`) and assembles `{task, recent_activity, health}`.
- `summarizeRecentActivity` returns at most `options.limit` events (default 5), strictly before the wakeup's sequence, in chronological order, with the same 160-char redactor as the activity field.
- The redactor pattern is reused unchanged; the prompt must never contain a base64/JWT blob. The new P6-style assertion (`assert.doesNotMatch(request.prompt, /base64|eyJ[A-Za-z0-9]/i)`) is enforced inside the new context-summary test.

### 3. Dedup (new)

- `coalesceWakeups(wakeups, {window_ms})` is a pure function with no side effects.
- The dedup key is `${role}|${state}|${summary(activity)}`; wakeups older than `window_ms` are returned as-is (no collapse across the window boundary).
- `coalesced_count` is the *total* count of wakeups collapsed into the survivor (3 wakeups collapsed → `coalesced_count = 3`); `coalesced_ids` is the list of suppressed siblings (excludes the survivor).
- The dispatcher merges the coalesced metadata onto the claimed wakeup before calling `formatLeadWakeup`, so the Lead prompt surfaces "this notification replaced 2 previous ones" when applicable.

### 4. Concurrency (new)

- `claimLeadWakeup` is the only atomic primitive. It increments `attempts` is **not** touched here; `recordLeadWakeupDelivery` still owns the attempt counter so the existing test that expects `attempts = 1` after one failed dispatch stays green.
- The dispatcher loop now: (a) `coalesceWakeups`, (b) for each survivor `claimLeadWakeup`, (c) on `null` claim push to `skipped` with `skip_reason`, (d) on success `sendMessageToThread` + `recordLeadWakeupDelivery`.
- The new "concurrent dispatches deliver each wakeup exactly once" test exercises this with two `Promise.all` dispatches behind a single `gate` promise; both dispatchers race on the queue, exactly one wakes up first and delivers each wakeup, the other observes `in_flight` and skips.

### 5. Observable degradation (new)

- `summarizeWakeupHealth` is the metrics helper; `degraded = (stuck > 0 || failed > 0)`.
- `getLeadWakeupHealth` is the Lead-facing observability surface; it returns the queue plus the health summary. Validation errors (invalid task ID, missing state root) propagate to the caller as hard errors rather than silently empty digests.
- `renderLeadWakeupDigest` is the plain-text projection: `task_id / task_name / task_description / binding / pending / failed / in_flight / stuck / degraded / last_error`. It is safe to embed directly inside a wakeup prompt.

## Boundary discipline

- **Lead binding** is unchanged. `registerLead` / `unregisterLead` accept the same `(thread_id, host_id)` shape and refuse rebinding to a different `(thread_id, host_id)`. The binding cannot be cleared by any Agent-side operation.
- **Critical-state filter** is unchanged. `LEAD_WAKE_STATES = {"blocked", "changes_requested", "ready_for_review", "ready_for_acceptance", "completed"}`; only these states enqueue a wakeup. `working` and `waiting` never produce wakeups.
- **Blackboard MCP tool surface** is unchanged. `blackboard_register_lead`, `blackboard_unregister_lead`, `blackboard_list_lead_wakeups`, `blackboard_ack_lead_wakeup` remain the only Lead-facing wakeup tools. The new functions live in the adapter module and are available to the Lead host via Node import; the MCP server was intentionally **not** extended because the new functions are diagnostics (`getLeadWakeupHealth`, `renderLeadWakeupDigest`) and the Lead calls them through the existing `blackboard_snapshot` path.
- **Bounded peer topology** is unchanged. The new functions do not import or alter `policy.mjs` / `runtime-policy.mjs`.
- **Audit redaction** is unchanged. The new context summary reuses the existing `summary()` helper; the prompt never contains a base64/JWT blob.
- **Wire envelope** (`agent-team/v1` / `body_encoding: base64url`) is unchanged. The new functions do not touch `makeEnvelope` or `parseEnvelope`.

## Out-of-scope (deliberately not touched)

Per `research/ISSUE-030.md` §5 "must NOT change" and the Lead task contract:

- G1 (structured `error_class` on `failed` wakeups) — ADR-level decision.
- G2 (backoff / `next_retry_at`) — ADR-level decision.
- G3 (per-attempt nonce) — ADR-level decision.
- G5 (binding-stale auto-detection) — ADR-level decision.
- G6 (unbound wakeup accumulation cap) — load + ADR-level decision.
- G8 (redactor hardening for plain JWTs inside activity text) — separate defect.
- G9 (empty `delivery_id` rejection) — would require modifying the existing dispatcher's `result?.delivery_id || randomUUID()` fallback, which the pre-existing test "Lead wakeup adapter delivers, records, acknowledges, and retries host failures" explicitly relies on for the `{threadId: request.thread_id, delivery_id: "delivery-002"}` shape.

These belong in a follow-up task or ADR; they are not part of Issue #4's "上下文摘要 + 游标去重 + 并发处理 + 失败降级" scope.

## Remaining risks

1. **`tests/team-contract.test.mjs` "acceptance requires..."** — pre-existing PowerShell encoding failure in `scripts/pi-team.ps1:Get-BlackboardTask`. Not introduced by this slice (verified via `git stash`); outside the Issue #4 scope.
2. **No live smoke** of the new functions through the host adapter. The deterministic tests cover the adapter with a stub `sendMessageToThread`. A live smoke would require a Codex Lead thread + the Blackboard MCP server; the project_state records that BB-FIX-001 covered the causal event path but not the wakeup host path. Lead may want a follow-up smoke (cf. Researcher's §7 caveat).
3. **Researcher's read of the redactor regex** is slightly imprecise (`=*` does match `abc=` once the prefix is 32+ chars), but the redactor was not modified and the existing test `assert.doesNotMatch(request.prompt, /base64|eyJ[A-Za-z0-9]/i)` covers the visible patterns. If a Lead review surfaces a real bypass, file a follow-up.

## Fix cycle 1 — REVIEW_FAIL: `cross-role-sequence-cutoff`

The Reviewer (artifact `failures/ISSUE-030-cross-role-sequence-cutoff.md`, severity "real functional defect") found that the original slice used the wakeup's **role-local** `sequence` as a global cutoff when computing the recent-activity digest:

- `listAgentEvents(projectRoot, taskId, { before_sequence: wakeup.sequence })` applied `event.sequence < wakeup.sequence` across every role's event file.
- `summarizeRecentActivity(events, { before_sequence: wakeup.sequence })` did the same in-memory.
- Because each role numbers its own sequence independently (the executor's `ready_for_review` may have sequence 2 while the researcher has emitted 5 prior events), the filter silently dropped those researcher events from the digest. The new multi-role regression test the Reviewer added (`tests/blackboard.test.mjs` "context digest keeps recent cross-role activity before the wakeup regardless of role-local sequence") reproduces this with `researcher` seq 1..5 + `executor` seq 1 working + `executor` seq 2 ready_for_review; before the fix the digest returned only `executor:1` and `researcher:1`.

### Fix applied

1. **`plugins/agent-blackboard/server/blackboard-core.mjs`** — `listAgentEvents` now accepts an additional `before_observed_at` (ISO 8601) cutoff. `observed_at` is globally comparable, so a strict `<` filter is safe across roles. `before_sequence` is kept for backward compatibility but documented as role-local; callers that need cross-role filtering must use `before_observed_at`.
2. **`plugins/agent-blackboard/server/lead-wakeup-adapter.mjs`** — `summarizeRecentActivity` accepts `before_observed_at` and combines it (AND) with `before_sequence` when both are provided.
3. **`plugins/agent-blackboard/server/lead-wakeup-adapter.mjs`** — `buildLeadWakeupContext` no longer passes `before_sequence` to `listAgentEvents`; it passes `before_observed_at: wakeup.created_at` only, so the digest covers every role whose events strictly precede the wakeup in time. The same is true for the in-memory `summarizeRecentActivity` call.
4. **Tests** — the Reviewer added the multi-role regression test; it now passes. The pre-existing single-role context test continues to pass (time-based filtering produces the same observable digest for a single-role scenario).
5. **No public API removed.** The `before_sequence` filter is still exported on both functions; it is now correctly described as role-local.

### Re-validation after the fix

```
$ cd D:\Coding\Harness\Pi-team-ISSUE-030
$ node --test tests/blackboard.test.mjs tests/communication-policy.test.mjs
...
ℹ tests 76
ℹ pass 67
ℹ fail 0
ℹ skipped 9
ℹ duration_ms 10440.7292
```

- `tests/blackboard.test.mjs`: **18 / 18 pass** (10 pre-existing + 7 new from cycle 0 + 1 multi-role regression from cycle 1).
- `tests/communication-policy.test.mjs`: **49 / 49 pass** (9 pre-existing skipped).
- `tests/team-contract.test.mjs`: 20 / 21; the same pre-existing PowerShell-encoding failure (not introduced by either slice).

### Updated file diff (cycle 1)

```
$ git diff --stat
 plugins/agent-blackboard/server/blackboard-core.mjs     | 24 ++++++---
 plugins/agent-blackboard/server/lead-wakeup-adapter.mjs | 38 +++++++++++----
 tests/blackboard.test.mjs                               | 30 +++++++++++++
 3 files changed, 79 insertions(+), 13 deletions(-)
```

All three files are the same as cycle 0 plus the targeted fix. Public CLI, role prompts, skills, communication policy, MCP surface, wire envelope, bounded peer topology, and Lead skill are still byte-identical to `develop`.

## Hand-off to Reviewer

Reviewer should re-run:

```
cd D:\Coding\Harness\Pi-team-ISSUE-030
node --test tests/blackboard.test.mjs tests/communication-policy.test.mjs
```

Expected: 66 / 66 (skipping the 9 pre-existing communication-policy skips). The 7 new blackboard tests must all pass. The pre-existing 10 blackboard tests must still pass byte-identical.

Reviewer should also `git diff` to confirm:

- `plugins/agent-blackboard/server/blackboard-core.mjs` — only additive (new exported `listAgentEvents`, `claimLeadWakeup`; `listLeadWakeups` payload grew `name` + `description`).
- `plugins/agent-blackboard/server/lead-wakeup-adapter.mjs` — exports grew; `dispatchLeadWakeups` body changed to add `claimLeadWakeup` and `coalesceWakeups`.
- `tests/blackboard.test.mjs` — only additive (no existing assertion changed).
- `.pi/agents/`, `.pi/skills/`, `scripts/pi-team.ps1`, `plugins/agent-blackboard/server/blackboard-mcp.mjs`, `plugins/agent-blackboard/server/blackboard-cli.mjs`, `plugins/agent-blackboard/skills/*` — must be byte-identical to `develop`.

Reviewer may also verify the contextual prompt by reading the new test's `assert.match` calls; every line they assert is present comes from the new code path, not from `develop`.

## Slice completion

This Executor slice is READY_FOR_ACCEPTANCE (Reviewer pass; Lead acceptance is the separate second gate). No commit was made; no push was made; the persistent pair remains alive and event-driven; the Lead binding for ISSUE-030 stays registered.

## Reviewer gate (cycle 2)

The paired Reviewer sent a REVIEW_PASS after cycle 1 fix. Full review is in reports/ISSUE-030-review.md.

- F1 (resolved in cycle 1): cross-role sequence cutoff defect. Fix switched recent-activity cutoff from role-local sequence to globally comparable observed_at. Reviewer added multi-role regression test that now passes.
- F2 (non-blocking observation, out of slice scope): dead markInFlight helper in lead-wakeup-adapter.mjs that returns a no-op setter and is never called. Real concurrency path uses claimLeadWakeup in blackboard-core.mjs. Reviewer flagged as maintainability hazard and explicitly did not block. Executor intentionally NOT removing in same slice because Reviewer gate passed, cleanup requires separate Lead acceptance check, widening scope would risk rejecting Lead acceptance. Lead may accept as-is and file follow-up cleanup, or reject with LEAD_REQUEST_CHANGES for cycle 3.

## What Lead acceptance must verify

- node --test tests/blackboard.test.mjs tests/communication-policy.test.mjs from D:/Coding/Harness/Pi-team-ISSUE-030 produces 67 / 67 (skipping 9 pre-existing communication-policy skips).
- git diff develop..HEAD is exactly three files: blackboard-core.mjs, lead-wakeup-adapter.mjs, blackboard.test.mjs.
- git diff on .codex-plugin, blackboard-mcp.mjs, blackboard-cli.mjs, skills, scripts, .pi/communication, .pi/agents, .pi/skills, AGENTS.md, README.md, ADR is empty.
- acceptance.json covers C-002 and C-004 with citations to the artifacts above.
- After acceptance, Lead runs pi-team.cmd accept ISSUE-030, pi-team.cmd reclaim ISSUE-030, blackboard_archive_task ISSUE-030, and (optionally) pi-team.cmd cleanup ISSUE-030. Persistent pair stays alive until reclamation.
