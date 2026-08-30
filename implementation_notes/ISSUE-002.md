# ISSUE-002 — Implementation Notes

## Slice

- Task ID: ISSUE-002 (delegation `EXECUTOR-ISSUE-002`)
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-002`
- Branch: `pi-team/ISSUE-002-empty-terminals`
- Done criteria covered: C-002, C-004

## Root cause (from research artifact)

`tests/team-contract.test.mjs` line 475 wrote a console-subsystem `fake-pi.cmd`
batch file. `scripts/pi-team.ps1` line 314 called
`Start-Process $Executable -WindowStyle Normal -PassThru` for every role launch.
The real `wt.exe` is GUI-subsystem (no console allocation), but
`fake-pi.cmd` is a console-subsystem binary that allocated a visible empty
console window every time the test asked for a launch (5 windows per test run:
2 from `start`, 1 from `research`, 2 from `resume`).

Residue came from the same path: the test cleanup waited 750 ms and called
`git worktree remove --force`, neither of which deterministically killed the
fake launcher chain (`cmd.exe → cmd.exe → powershell.exe → powershell.exe →
cmd.exe → powershell.exe`). Only the outermost `cmd.exe` (`launcher_pid` from
state JSON) and the innermost `powershell.exe` (`runtime_pid` from runtime JSON)
were tracked, and only `Start-Task`'s catch path (`Stop-RoleTree`) used them.

## Files changed

| File | Change | Why |
| --- | --- | --- |
| `scripts/pi-team.ps1` | `Start-Process -WindowStyle $windowStyle` with conditional `Hidden` when `WT_CMD` points at a non-wt test stub | Only affects test stubs (real wt.exe unchanged). Eliminates visible empty console windows during the role-launchers test. |
| `tests/team-contract.test.mjs` (fake-pi.ps1 record branch) | Added `process_chain` array and `parent_pid` derived from `Get-CimInstance Win32_Process` | Test cleanup can `taskkill /T /F` every recorded node without timing tricks. |
| `tests/team-contract.test.mjs` (fake-pi.ps1 header) | Added 15-second watchdog (`PI_TEAM_FAKE_TIMEOUT_SEC`) that `Stop-Process -Force` + `exit 124`s if a hung fake escapes cleanup | Defense in depth: even if cleanup is skipped or fails, the fake cannot outlive the test. |
| `tests/team-contract.test.mjs` (fake-pi.cmd body) | `@echo off` then `start "" /b powershell.exe ... >nul 2>&1` then `exit /b 0` | The `start /b` shares the parent's console and the immediate `exit /b 0` closes the cmd.exe wrapper before the visible console can settle. |
| `tests/team-contract.test.mjs` (cleanup `finally`) | Replaced 750 ms empirical sleep with deterministic `taskkill /T /F` over `runtime.process_chain` � `{runtime_pid}` from each role's runtime JSON | The cleanup no longer relies on timing. `taskkill /T` cascades to the entire recorded tree. |
| `tests/team-contract.test.mjs` (post-resume) | New assertion verifying each role's `process_chain` contains its `runtime_pid` and is non-empty | Catches regressions in process-chain recording and prevents silent breakage of the deterministic cleanup. |

## Test semantics preserved

Every assertion in the existing "role launchers inject common-dir identity"
test continues to hold:

- `start` produces two records (executor + reviewer) with `--no-extensions`,
  `--no-skills`, `--tools <expected>`, `--session-id`, `--skill <expected>`,
  no `--agent`, no Lead-only tokens, no other-role delegation ids, distinct
  agent IDs, expected `state_root`, no contract path, no worktree-snapshot
  extension path.
- `research` produces one record with `--no-extensions`, `--no-skills`,
  `--tools <RESEARCHER_TOOLS>`, no `--session-id`, distinct agent IDs.
- `resume` produces two records with `--session`, no `--session-id`,
  `--no-extensions`, reusing the original agent IDs and session IDs.
- New assertion: every role's runtime JSON records `process_chain` with
  `runtime_pid` included.

## Validation performed

- `powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1`
  → 42 tests, all pass. Duration ≈ 33 s (the role-launchers test went from
  ≈ 31 s to ≈ 19–33 s depending on warm cache; previously the 750 ms sleep
  per launch and the empirical cleanup were the dominant overhead).
- `git worktree list` after the run shows only the persistent harness
  worktrees; no `pi-team/test-runtime-*` worktree path remains.
- `git branch --list 'pi-team/test-runtime-*'` after the run is empty.
- `Get-Process powershell,cmd,WindowsTerminal,OpenConsole` after the run
  shows only the persistent harness shells; no fake-pi processes remain
  (the watchdog and `taskkill /T /F` clean the chain).
- `git diff -- scripts/` shows the 8-line `pi-team.ps1` change. `wt.exe`
  production behavior is unchanged: the conditional only fires when
  `$env:WT_CMD` is set AND the executable path is not the real `wt.exe`.

## Cross-task impact

- `tests/run-tests.ps1` unchanged.
- `tests/communication-policy.test.mjs` unchanged (does not exercise
  `Start-Process`).
- `tests/blackboard.test.mjs` unchanged (does not exercise `Start-Process`).
- The setup test (`setup is isolated, pinned, idempotent …`) is unchanged
  because it uses its own `fake-pi.ps1` only (synchronous `& $pi install`).
- Other Issue plans (Issue #1 prompt boundaries, Issue #3 research
  authorization, etc.) are out of scope and untouched.

## Research requests and results

- **Outbound**: none. The Researcher had already produced
  `research/ISSUE-002-empty-terminal-paths.md` before this slice began and
  the artifact's four fixes mapped cleanly to the chosen approach.
- **Inbound**: none during this slice. The Reviewer will re-check the diff
  and the validation evidence.

## Remaining risks

- The watchdog reads `Get-CimInstance Win32_Process`. On a cold WMI cache
  this can add ~50–100 ms per fake. The role-launchers test budget already
  absorbs this; if the budget tightens later, the chain walk can be cached
  to a per-test file (out of scope here).
- `taskkill /T /F` cascades only to processes still alive when the kill is
  issued. The 100 ms post-kill delay gives the kernel one tick to deliver;
  in practice the chain exits synchronously, but a slower machine could
  leave a race. The watchdog is the second line of defense.
- The `WindowStyle` switch is a string-typed conditional. A future test that
  names its launcher `wt-fake.cmd` would still be classified as a non-wt
  test stub (the regex requires `wt.exe` or `wt` at the path tail). If a
  future test deliberately wants a visible window it can set
  `$env:PI_TEAM_FORCE_WINDOW_NORMAL=1` (not added; not needed yet).

## Slice state

`READY_FOR_REVIEW` — paired Reviewer should reproduce
`tests/run-tests.ps1`, inspect the diff, and confirm `scripts/pi-team.ps1`
real-wt.exe path is unchanged.
