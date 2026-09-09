# COMPRESSION-001 — Plain resume silently reuses a resource-constrained session

**Task:** COMPRESSION-001
**Finding:** `plain-resume-reuses-constrained-session`
**Severity:** High
**Status:** Open (REVIEW_FAIL)

## Summary

C-004 item 5 requires that a plain `resume` must not silently reuse a session
that was stopped by a resource limit. The current `Resume-Task` relaunches the
role with the **same** `session_id` and performs **no** check for a
resource-limit stop or checkpoint, so a constrained session would be silently
reused instead of forcing the explicit `resume-checkpoint` path (which mints a
new session ID).

## Root cause

`scripts/pi-team.ps1` `Resume-Task` (lines ~541-551):

```powershell
function Resume-Task([string]$TaskId) {
  Assert-Setup; $s=Read-State $TaskId
  if ($s.execution_status -ne 'active') { Fail 'task is not active' }
  Assert-NoLiveRoleProcesses $s
  $contract = Parse-Contract $s.contract_path
  foreach($r in @('executor','reviewer')) {
    $context = New-RoleContext $contract $r 'resume'
    Launch-Role $s $r "$context Resume the existing Lead task session as $r and continue the assigned work." $s.sessions.$r.session_id $true
  }
  Write-Output "RESUMED $TaskId"
}
```

It passes `$s.sessions.$r.session_id` — the exact same ID — and never consults
`last_stop_reason`, `last_checkpoint_path`, or `resumed_from_checkpoint`.
Compare `Resume-From-Checkpoint`, which explicitly mints a new session ID and
records `previous_session_id`.

## Reproduction

- Static check on `scripts/pi-team.ps1`: `Resume-Task` contains no reference to
  `last_stop_reason`, `last_checkpoint_path`, or `resumed_from_checkpoint`, and
  relaunches the stored session ID unchanged.
- Captured as `tests/automatic-compression.test.mjs` → `C-004 behavior 5:
  plain resume must not silently reuse a session that was stopped by a
  resource cap` (FAILING).

## Expected vs observed

- **Expected (C-004 item 5):** when the task state indicates a role was stopped
  by a resource limit, a plain `resume` must refuse (or route to
  `resume-checkpoint`) rather than relaunching the same constrained session.
- **Observed:** `Resume-Task` relaunches the same `session_id` with no
  constraint check.

## Criteria violated

- **C-004** item 5 (reviewer): "普通 resume 不会静默复用受限会话".

## Fix direction (executor)

In `Resume-Task`, detect a resource-limit stop from the task state (e.g., a
`last_stop_reason` whose `code` is a resource-cap code, or a
`last_checkpoint_path`/`resumed_from_checkpoint` marker) and `Fail` with a
message directing the Lead to use `pi-team.cmd resume-checkpoint ...`. Note
this depends on Defect
`checkpoint-never-written-on-resource-cap-stop` being fixed first, because the
stop record is never persisted today.

## Evidence

- `tests/automatic-compression.test.mjs` (behavior 5, failing).
- `scripts/pi-team.ps1` `Resume-Task` source inspection.
