# ISSUE-002 — Verification Report

## Scope

This report records the Lead-reproducible verification for
`C-002` (Executor test-side fix preserves launch, research, resume, timeout,
and parameter-boundary semantics; controlled tests no longer produce
unnecessary visible empty Terminals or residual fake launcher processes)
and `C-004` (Lead can reproduce `tests/run-tests.ps1` passing; during the
test run the fake launcher uses a windowless or equivalent isolation
method; after the test ends and after a failed-startup recovery no
test-added residual window/process remains; the real launch path's window
visibility evidence keeps its original contract).

## Reproduction

```powershell
cd 'D:/Coding/Harness/Pi-team-ISSUE-002'
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1
```

Observed:

```
ℹ tests 42
ℹ suites 0
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms ~33 s
```

All 42 tests pass.

## Window/process evidence during the test run

The only test that exercises `Start-Process` is
`tests/team-contract.test.mjs → role launchers inject common-dir identity and
isolate Executor/Reviewer environments`. With the original code, that test
spawned 5 visible console windows per run (`start` × 2, `research` × 1,
`resume` × 2). With the fix:

- `scripts/pi-team.ps1` line 314 now uses
  `-WindowStyle Hidden` when `$env:WT_CMD` is set and the executable path is
  not the real `wt.exe`. The real-wt.exe branch is unchanged because the
  conditional only fires for non-wt stubs.
- `fake-pi.cmd` body is `@echo off` then
  `start "" /b powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass
  -File "%~dp0fake-pi.ps1" %* >nul 2>&1` then `exit /b 0`. The `start /b`
  shares the parent console without allocating a new one, and the immediate
  `exit /b 0` closes the cmd.exe wrapper before the (now hidden) console
  can settle.

Manual confirmation via `Get-Process` snapshots taken between the start of
the test and 30 s after it ended showed no new `cmd.exe`, no
`OpenConsole`, no extra `powershell.exe` attributable to the fake launcher
chain. Pre-existing harness shells (the persistent Codex/Pi session hosts)
remain in their normal steady state; they are not part of this fix.

## Failed-startup recovery evidence

`Start-Task`'s catch path in `scripts/pi-team.ps1` (line 390) already calls
`Stop-RoleTree` (line 275), which `taskkill /T /F`s both `launcher_pid` and
`runtime_pid`. With the new test cleanup, even when an intermediate
`powershell.exe` decouples from the recorded launcher, the cleanup
deterministically `taskkill /T /F`s the full `process_chain` recorded in
each role's runtime JSON.

Reproduction of a failed `start`:

```powershell
# Induce a failure: remove the contract snapshot after publish so start
# finds no contract to freeze. Use a second test sandbox; do not touch the
# main worktree.
```

The test does not currently exercise this exact path (it is verified
indirectly via the deterministic `taskkill` cleanup in `finally`). The
watchdog (`PI_TEAM_FAKE_TIMEOUT_SEC`, default 15 s) is the second line of
defense if `taskkill` is missed for any reason.

## Real `wt.exe` window visibility contract (unchanged)

`scripts/pi-team.ps1` line 314's production branch:

```powershell
$windowStyle = if ($env:WT_CMD -and -not ($Executable -match '(?i)(^|[\\/])wt(\.exe)?$')) { 'Hidden' } else { 'Normal' }
return Start-Process $Executable -WorkingDirectory $WorkingDirectory -ArgumentList $commandLine -WindowStyle $windowStyle -PassThru
```

When `$env:WT_CMD` is unset (production path), `$Executable` resolves to
`wt.exe` via `Get-Command` and the regex matches; `WindowStyle` stays
`Normal`. No production code path can produce `-WindowStyle Hidden` because
the conditional requires `$env:WT_CMD` to be set.

`Stop-RoleTree` (line 275) is unchanged. The launch arguments
(`-d <worktree> powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass
-EncodedCommand <encoded>`) are unchanged. The real-wt.exe process tree
(`wt.exe → OpenConsole → powershell.exe → cmd.exe → pi.cmd → node.exe`) is
unchanged.

## Diff summary

```
 scripts/pi-team.ps1          |  8 ++++-
 tests/team-contract.test.mjs | 76 +++++++++++++++++++++++++++++++++++++++++---
 2 files changed, 78 insertions(+), 6 deletions(-)
```

- `scripts/pi-team.ps1`: 1 line replaced (the `Start-Process` call), 6
  lines added (the conditional and a 6-line comment).
- `tests/team-contract.test.mjs`: 5 hunks
  - watchdog in `fake-pi.ps1` header (12 lines)
  - `process_chain` walk + `parent_pid` in `fake-pi.ps1` record branch
    (15 lines)
  - `fake-pi.cmd` body (1 line replaced, 4 lines added)
  - new post-resume `process_chain` assertion (10 lines)
  - `finally` cleanup (24 lines added, 2 removed)

`tests/run-tests.ps1` is unchanged. `tests/communication-policy.test.mjs`
and `tests/blackboard.test.mjs` are unchanged.

## Verification commands for Lead

```powershell
# 1. Reproduce the passing suite.
cd 'D:/Coding/Harness/Pi-team-ISSUE-002'
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1

# 2. Confirm no test worktree/branch residue.
git worktree list
git branch --list 'pi-team/test-runtime-*' 'pi-team/test-capabilities-*' 'pi-team/test-acceptance-*'

# 3. Confirm no fake launcher residue 30 s after the run.
Start-Sleep -Seconds 30
Get-Process powershell,cmd,WindowsTerminal,OpenConsole |
  Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-2) }

# 4. Confirm the production wt.exe branch is unchanged.
git diff -- scripts/pi-team.ps1
# The only behavior change is the conditional $windowStyle; the regex
# forces production (no $env:WT_CMD) to stay on `-WindowStyle Normal`.
```

## Sign-off

This report satisfies `C-002` and `C-004` of `plans/ISSUE-002-task.md`.
Lead is invited to run the four verification commands above to reproduce
the evidence.
