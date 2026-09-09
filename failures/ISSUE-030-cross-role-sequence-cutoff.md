# ISSUE-030 — Real failure: `before_sequence` cross-role cutoff drops recent activity from the Lead context digest

- Task ID: **ISSUE-030**
- Finding ID: `cross-role-sequence-cutoff`
- Review slice: REVIEW-ISSUE-030 (paired Executor delegation `EXECUTOR-ISSUE-030`)
- Severity: **real functional defect** in the delivered "上下文摘要" (context summary) feature

## Summary

The new Lead wakeup context digest (`buildLeadWakeupContext` → `listAgentEvents` /
`summarizeRecentActivity`) uses the wakeup's **role-local sequence** as a global
`before_sequence` cutoff when reading **all roles'** event logs. Because each
role's event file numbers its own sequence independently (`blackboard-core.mjs`
`appendAgentEvent` computes `sequence` from the per-role `${taskId}-${role}.jsonl`
file), the filter `Number(event.sequence) < beforeSequence` applied across every
role wrongly drops recent activity from any role whose local sequence is >= the
wakeup's local sequence.

The Lead prompt therefore shows an incomplete / misleading "recent activity"
digest in a real multi-role task (Researcher produces many events, then Executor
reaches `ready_for_review`).

## Reproduction

From the worktree root, with a fresh repo fixture:

1. Create task, register a Lead, and append 5 `working` events for role
   `researcher` (role-local sequence 1..5), then 1 `working` event for role
   `executor`, then 1 `ready_for_review` event for role `executor` (the wakeup;
   executor role-local sequence 2).
2. Call `buildLeadWakeupContext(projectRoot, wakeup, { recent_activity_limit: 10 })`.

Observed digest (current behavior):

```
researcher:1 researcher-step-1
executor:1   executor-start
```

Expected digest — every event whose `observed_at` precedes the wakeup's
`created_at`, across all roles:

```
researcher:1 researcher-step-1
researcher:2 researcher-step-2
researcher:3 researcher-step-3
researcher:4 researcher-step-4
researcher:5 researcher-step-5
executor:1   executor-start
```

The 4 later researcher events are silently dropped even though they occurred
before the wakeup.

## Root cause

`plugins/agent-blackboard/server/blackboard-core.mjs` `listAgentEvents`:

```js
const beforeSequence = options.before_sequence === undefined ? undefined : Number(options.before_sequence);
...
if (beforeSequence !== undefined && Number.isFinite(beforeSequence)) {
  filtered = filtered.filter((event) => Number(event.sequence) < beforeSequence);
}
```

`before_sequence` is the wakeup's sequence, which is **role-local**
(`blackboard-core.mjs` `appendAgentEvent`: `const sequence = existing.reduce(...) + 1`
over the per-role file `${taskId}-${role}.jsonl`). The same role-local comparison
is repeated in `lead-wakeup-adapter.mjs` `summarizeRecentActivity`:

```js
return Number(event.sequence) < Number(beforeSequence);
```

Neither path scopes the comparison to the wakeup's own role nor uses a
time-based cutoff (`observed_at < wakeup.created_at` / `wakeup.observed_at`).

## Observed vs. expected

- Observed: digest contains only the events whose per-role sequence < the
  wakeup's per-role sequence, across every role.
- Expected: the digest contains the bounded most-recent events (by time) that
  strictly precede the wakeup, across every role, excluding only the wakeup's
  own event.

## Why the passing tests missed it

The new context-summary test ("Lead wakeup prompt injects task context, recent
activity digest, and degradation health") exercises only a **single role**
(`executor`), so the wakeup's role-local sequence is a correct cutoff for that
role's file. No test covers a multi-role digest where another role's local
sequence count exceeds the wakeup's.

## Suggested fix direction (for the Executor / next fix cycle)

Scope the sequence cutoff to the wakeup's own role, and/or base the "recent
activity" window on time (`observed_at < wakeup.created_at`), which is globally
comparable and matches the digest's documented intent ("recent activity that
preceded this wakeup"). Add a multi-role regression test (Researcher with more
local events than the Executor wakeup) asserting all pre-wakeup events from
every role appear in the bounded digest.

## Evidence

- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-030`, branch `pi-team/ISSUE-030`,
  base `develop` (b54cfe2).
- Reproduction script (removed after capture, per reviewer hygiene) used the
  public exports `createTask`, `appendAgentEvent`, `listLeadWakeups`,
  `listAgentEvents`, `buildLeadWakeupContext` from the worktree's modules.
- `node --test tests/blackboard.test.mjs tests/communication-policy.test.mjs` →
  66 pass / 0 fail / 9 pre-existing skip (single-role digest test passes; the
  defect is not covered by any existing test).
