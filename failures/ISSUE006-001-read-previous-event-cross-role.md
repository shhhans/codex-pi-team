# ISSUE006-001 — readPreviousEvent returns null when another role published a more recent event

## Failure description

`readPreviousEvent(stateRoot, taskId, role)` — the helper the
`blackboard_update` extension uses to feed the verbatim-repeat
anti-heartbeat check in `validateAgentUpdate` — returns `null` whenever
the single most recent event on the task board belongs to a *different*
role. The extension then treats the role as having no previous event and
the "identical repeat of the previous event is refused" guard is silently
disabled.

## Why this matters (acceptance criterion)

The task acceptance requires meaningful, verifiable Blackboard updates
and explicitly rejects "以无意义高频心跳替代进展" (replacing progress
with meaningless high-frequency heartbeats). ADR 0008 codifies this:
"Identical repeat of the previous event's `state` and `activity` is
refused so the role cannot mask real progress with a heartbeat." The
cross-role `null` return defeats that guarantee in the normal
multi-role flow.

The normal Pi Team flow interleaves roles on one task board:
Executor `working` → Reviewer `reviewing` / `changes_requested` →
Executor resumes on `FIX_READY`. After the Reviewer publishes, the
Executor's next `blackboard_update` reads `null` as "previous", so an
Executor re-publishing the same `activity` verbatim is accepted.

## Reproduction steps

1. Create a task, register nothing special (a lead binding is not
   required for `appendAgentEvent`).
2. `appendAgentEvent(executor, { state: "working", activity: "executor started slice on protocol", next: "add semantic validation" })`.
3. `appendAgentEvent(reviewer, { state: "reviewing", activity: "reviewer scanning diff for scope", next: "publish review verdict" })`.
4. `await readPreviousEvent(stateRoot(repo), taskId, "executor")`.

## Observed

`null` (the reviewer's event is the most recent on the board; `listAgentEvents`
with `{ limit: 1 }` returns only that one event, whose role does not match).

## Expected

The executor's own previous event, i.e. `{ role: "executor", sequence: 1,
activity: "executor started slice on protocol" }`. The verbatim-repeat
check in `validateAgentUpdate` must see the role's own most recent event
regardless of other roles publishing in between.

## Root cause

`.pi/communication/blackboard-protocol.mjs` `readPreviousEvent`:

```js
export async function readPreviousEvent(stateRoot, taskId, role, currentSequence) {
  if (!stateRoot || !taskId || !role) return null;
  const events = await listAgentEvents(stateRoot, taskId, { limit: 1 });
  for (const event of events) {
    if (event.role !== role) continue;
    ...
  }
  return null;
}
```

`listAgentEvents(stateRoot, taskId, { limit: 1 })` returns only the single
most-recent event across all three role files (`blackboard-core.mjs:544-564`,
sorted by `observed_at` then `sequence`, `slice(-limit)`). When that most
recent event is from another role, the loop has nothing to return for the
requested role.

## Regression test added by Reviewer

`tests/blackboard-protocol.test.mjs`:
"readPreviousEvent returns the role's own previous event even when another
role published a more recent event" — appends an executor event, then a
reviewer event, then asserts `readPreviousEvent(..., "executor")` returns
the executor's event. This test fails against the current code
(`actual: null`).

## Suggested fix (Executor-owned; Reviewer does not edit production code)

Fetch a window wide enough to include the role's own latest event and
scan for the most recent matching role (e.g., `limit: 500`), or iterate
per-role files, or filter by the role before taking the last event. The
`currentSequence` parameter must also be honored when the extension
passes it (today the extension does not pass it, so the function
currently relies solely on the `limit: 1` shortcut).

## Evidence

- Full deterministic suite: 159 tests, 0 fail, 9 skipped (passes).
- `node --test tests/blackboard-protocol.test.mjs`: 18 tests, 17 pass,
  1 fail — the new cross-role regression test fails with
  `AssertionError: readPreviousEvent must still find the executor's own
  previous event (actual: null)`.
- Standalone repro: `readPreviousEvent(executor) => null` with an
  interleaved reviewer event.
