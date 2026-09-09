# ISSUE-030 — Reviewer Report (REVIEW-ISSUE-030)

- Task ID: **ISSUE-030** (retry of GitHub Issue #4 — Blackboard 更新唤醒 Lead 并注入上下文)
- Role: Reviewer
- Delegation: REVIEW-ISSUE-030
- Paired Executor delegation: EXECUTOR-ISSUE-030
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-030`, branch `pi-team/ISSUE-030`, base `develop` (b54cfe2)
- Review status: **REVIEW_PASS** (F1 resolved in FIX_READY cycle; re-verified. Reviewer gate passed; Lead acceptance is the separate second gate.)
- Verdict (C-003): Reviewer independently checked diff, context, dedup, degradation, permissions, and test evidence.

## 1. Scope verification

Changed files (working tree vs `develop`):

```
 M plugins/agent-blackboard/server/blackboard-core.mjs
 M plugins/agent-blackboard/server/lead-wakeup-adapter.mjs
 M tests/blackboard.test.mjs
```

Untracked artifacts: `implementation_notes/ISSUE-030.md`, `reports/ISSUE-030-verification.md`,
`reports/ISSUE-030-review.md`, `research/ISSUE-030.md`, `research/ISSUE-030-blackboard-wakeup.md`,
`failures/ISSUE-030-cross-role-sequence-cutoff.md`.

Verified **byte-identical to `develop`** (empty `git diff`): `plugins/agent-blackboard/.codex-plugin`,
`.mcp.json`, `.app.json`, `blackboard-mcp.mjs`, `blackboard-cli.mjs`, `plugins/agent-blackboard/skills`,
`scripts/pi-team.ps1`, `.pi/communication`, `.pi/agents`, `.pi/skills`, `AGENTS.md`, `README.md`, `ADR`.

Scope is **clean and additive**: three files; no unrelated production, protocol, permission, or
launcher changes. Lead authority over binding (register/unregister), `LEAD_WAKE_STATES` filter,
MCP tool surface, wire envelope, and bounded peer topology are preserved. The new functions do not
import or alter `policy.mjs` / `runtime-policy.mjs` / envelope helpers.

## 2. Validation reproduced

From the worktree root (PowerShell 5.1):

```
$ node --test tests/blackboard.test.mjs tests/communication-policy.test.mjs
tests 75 | pass 66 | fail 0 | skipped 9
```

- `tests/blackboard.test.mjs`: Executor's 17 tests all pass (10 pre-existing byte-identical + 7 new).
- `tests/communication-policy.test.mjs`: 49 pass, 9 pre-existing skips — same baseline as `develop`.

After the Reviewer added a regression test (below), blackboard suite is 18 tests / 17 pass / 1 fail,
where the single failing test is the new regression capturing the real defect.

## 3. Done-criteria / Issue #4 sub-goal assessment

| Sub-goal | Assessment |
| --- | --- |
| Reliable wakeup | OK — existing chain byte-identical; `claimLeadWakeup` added inside dispatcher. |
| Context summary (上下文摘要) | **FAIL** — see finding F1. |
| Cursor dedup (游标去重) | OK — `coalesceWakeups` collapses matching `(role,state,activity)` inside rolling window; outside-window untouched. |
| Concurrency (并发处理) | OK — `claimLeadWakeup` atomic under task lock; concurrent dispatch test passes (exactly-once). |
| Observable degradation (失败降级) | OK — `summarizeWakeupHealth`/`getLeadWakeupHealth`/`renderLeadWakeupDigest`; degraded/stuck/failed/in_flight surfaced. |
| Lead authority boundary preserved | OK — adapter cannot rebind/clear binding; MCP/CLI/policy unchanged. |

## 4. Findings

### F1 — REAL FAILURE (RESOLVED in FIX_READY cycle): cross-role `before_sequence` cutoff dropped recent activity

- Artifact: `failures/ISSUE-030-cross-role-sequence-cutoff.md`
- Location: `blackboard-core.mjs` `listAgentEvents`; `lead-wakeup-adapter.mjs` `summarizeRecentActivity` / `buildLeadWakeupContext`.
- Problem (cycle 0): sequence numbers are **role-local** (`appendAgentEvent` derives `sequence` from the per-role
  `${taskId}-${role}.jsonl` file, each role starting at 1). The new context digest applied the wakeup's
  role-local sequence as a global `before_sequence` cutoff across **all roles**, so recent events from a
  role whose local sequence count exceeds the wakeup's were silently dropped.
- Reproduction (cycle 0): 5 researcher `working` events (role-local seq 1..5) then executor
  `working` (seq 1) + `ready_for_review` (seq 2, the wakeup). `buildLeadWakeupContext` returned a digest of
  only `[researcher:1, executor:1]` instead of all 6 events that precede the wakeup in time.
- **Fix (cycle 1, verified)**: `listAgentEvents` and `summarizeRecentActivity` now accept
  `before_observed_at` (ISO 8601, globally comparable, strict `<`). `buildLeadWakeupContext` passes only
  `before_observed_at: wakeup.created_at` to both `listAgentEvents` and `summarizeRecentActivity` and no
  longer passes the role-local `before_sequence`. Since `wakeup.created_at = event.observed_at`
  (`makeLeadWakeup`), the digest includes every event strictly before the wakeup's own event and excludes
  the wakeup's own event. `before_sequence` is retained but documented as role-local.
- Re-validation: reviewer regression test "context digest keeps recent cross-role activity before the wakeup
  regardless of role-local sequence" (tests/blackboard.test.mjs:531) now **passes**; full suite
  `tests/blackboard.test.mjs tests/communication-policy.test.mjs` → 76 tests / 67 pass / 0 fail / 9
  pre-existing skip.

### F2 — NON-BLOCKING observation: dead misleading `markInFlight`

- `lead-wakeup-adapter.mjs:237` defines `markInFlight` (async, returns a no-op setter) but it is never
  called anywhere (grep across adapter, tests, core). Its comment claims it marks wakeups in-flight before
  dispatch, which is not what the dispatcher does (real concurrency safety comes from `claimLeadWakeup`).
- Impact: maintainability hazard / misleading contract; no functional or test impact. Not a blocking
  failure; flagged for cleanup.

## 5. Pre-existing failure (out of scope)

- `tests/team-contract.test.mjs:818` "acceptance requires each frozen criterion ID…" fails:
  `Blackboard snapshot returned invalid JSON` from `scripts/pi-team.ps1:Get-BlackboardTask` — a PowerShell
  5.1 GBK output-encoding issue when piping Node stdout with non-ASCII (Chinese) task names to
  `ConvertFrom-Json`. `scripts/pi-team.ps1` is byte-identical to `develop` and outside Issue #4's visible
  scope. The slice does not import/alter that path. Reported as a separate pre-existing defect, not
  attributable to this slice.

## 6. Reviewer gate (dual acceptance, first gate)

- Diff limited to task scope: **pass**.
- Done criteria coverage: **pass** (F1 resolved; regression test green).
- Validation reproducible and recorded: **pass** (76/67/0/9 for the combined suite; 18/18 for blackboard).
- Artifacts present and consistent: **pass** (implementation notes, verification report, research, failure
  artifact retained for audit).
- No raw traces/envelopes presented as delivery evidence: **pass**.

Because F1 is resolved and re-verified, the first (Reviewer) gate passes. `REVIEW_PASS` was sent to the
Executor with `evidence_paths ["tests/blackboard.test.mjs"]` and `artifact_path "reports/ISSUE-030-review.md"`.
Lead acceptance remains the separate second gate.
