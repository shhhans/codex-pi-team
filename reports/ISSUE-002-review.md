# ISSUE-002 — Review Report

- Task ID: ISSUE-002 (delegation `REVIEW-ISSUE-002`)
- Done criterion: C-003
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-002`
- Branch: `pi-team/ISSUE-002-empty-terminals` (uncommitted diff vs `develop`, head `bd46d12 chore: define Issue 2 task contract`)
- Reviewer persistent pair: `pi-team--ISSUE-002--executor` (delegation `EXECUTOR-ISSUE-002`)
- Paired Executor artifacts reviewed:
  - `implementation_notes/ISSUE-002.md`
  - `reports/ISSUE-002-verification.md`
- Researcher artifact re-read for cross-check: `research/ISSUE-002-empty-terminal-paths.md`

## Verdict

**REVIEW_PASS** — C-003 satisfied. The Executor reproduced the failure
diagnosis from the Researcher artifact, applied a minimal test-side fix
plus a narrowly scoped test-only conditional in `scripts/pi-team.ps1`,
and demonstrated zero visible windows and zero residue under stress.
Real `wt.exe` production behavior is preserved by construction.

## Reviewer scope

C-003 asks the Reviewer to independently confirm:
1. Root-cause diagnosis matches the artifact.
2. Diff matches the Lead-assigned objective (test-side fix, no scope drift).
3. Window/process evidence supports the no-window, no-residue claim.
4. Existing test semantics are preserved (start, research, resume, timeout,
   parameter boundaries).
5. Real `wt.exe` product behavior boundary is unchanged.
6. Failed-startup cleanup is deterministic.

## 1. Root-cause re-verification

Reproduced the diagnosis from `research/ISSUE-002-empty-terminal-paths.md`:

- `tests/run-tests.ps1` is a thin Node launcher; it does not call
  `Start-Process` and does not allocate windows.
- `tests/team-contract.test.mjs:475` previously wrote a console-subsystem
  `.cmd` (`fake-pi.cmd`) that `Start-Process … -WindowStyle Normal`
  (`scripts/pi-team.ps1:314`) would have allocated a visible console for
  on every `start`/`research`/`resume` invocation (5 windows per role
  test run).
- Real `wt.exe` is GUI-subsystem, so the same `Start-Process` call
  allocates no console in production. The single subsystem difference
  is the source of the empty-Terminal symptom.
- Cleanup (`tests/team-contract.test.mjs:622-628` original) relied on a
  750 ms sleep + `git worktree remove --force`, neither of which
  deterministically killed the recorded
  `launcher_pid → cmd.exe → cmd.exe → powershell.exe → powershell.exe →
  cmd.exe → powershell.exe` chain. Only `Start-Task`'s catch path
  (`scripts/pi-team.ps1:390` → `Stop-RoleTree` line 275) used
  `taskkill /T /F`.

Confirmed via `grep` and `read` of the affected files; no new
files outside scope were touched.

## 2. Diff scope

```
 scripts/pi-team.ps1          |  8 ++++-
 tests/team-contract.test.mjs | 76 +++++++++++++++++++++++++++++++++++++++++---
 2 files changed, 78 insertions(+), 6 deletions(-)
```

- `tests/run-tests.ps1` — **not** touched. ✓
- `tests/communication-policy.test.mjs` — **not** touched. ✓
- `tests/blackboard.test.mjs` — **not** touched. ✓
- `research/ISSUE-002-empty-terminal-paths.md` — produced by the
  Researcher; not modified by the Executor. ✓
- `scripts/pi-team.ps1` — minimal change, only inside
  `Start-RoleProcess` (the launch path). Out-of-scope functions
  (`Stop-RoleTree`, `Start-Task`, `Research`, `Resume-Task`,
  `New-RoleAssignment`, `Assert-BlackboardTask`, etc.) are unchanged.
- `tests/team-contract.test.mjs` — additions confined to:
  - the `role launchers inject common-dir identity …` test's
    `fakePiScript`, `fakePi`, post-resume assertions, and `finally`.
  - no other test in the file is altered.

The diff matches the Lead objective: test-side fix + minimal,
test-only test-isolation tweak in production code (task contract
in_scope bullet 2 explicitly allows this).

## 3. `scripts/pi-team.ps1` conditional — boundary correctness

```powershell
$windowStyle = if ($env:WT_CMD -and -not ($Executable -match '(?i)(^|[\\/])wt(\.exe)?$')) { 'Hidden' } else { 'Normal' }
return Start-Process $Executable -WorkingDirectory $WorkingDirectory -ArgumentList $commandLine -WindowStyle $windowStyle -PassThru
```

Logic walk-through (validated by `.tmp/test-regex.ps1`):

| `$env:WT_CMD` | `$Executable` | Regex match | `$windowStyle` |
| --- | --- | --- | --- |
| unset (production) | `wt.exe` (line 371 default) | ✓ | **Normal** (unchanged) |
| set | `wt.exe` or `WT.exe` or path ending in `wt[.exe]` | ✓ | **Normal** |
| set | `fake-pi.cmd` | ✗ | **Hidden** |
| set | `wt-fake.exe` / `wtfake.exe` / `WTEXT.EXE` / etc. | ✗ | **Hidden** |
| set | empty / `/wt/foo.exe` | ✗ | Hidden (edge, harmless) |

Edge cases confirmed by direct regex probe:
`wt`, `wt.exe`, `WT.EXE`, full paths ending in `wt[.exe]` → match;
`fake-pi.cmd`, `wt-fake.exe`, `wtfake.exe`, `C:\app\wtext.exe`,
`C:\what\foo.exe`, `WTEXE` (no dot), `C:\path\to\wt-extended.exe` → no match.
The case-insensitive flag (`(?i)`) handles `WT.EXE` correctly.

Boundary is therefore preserved: production callers (no `$env:WT_CMD`)
cannot reach the `Hidden` branch; test stubs (set `$env:WT_CMD` to a
non-wt path) always reach it.

## 4. Window/process evidence (reproduced)

- Single full run: `powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1`
  → 42/42 pass, duration ~35 s.
- Stress run (5 consecutive runs, ~3 min total): every run reported
  42/42 pass; durations 33.8 s, 36.3 s, 38.4 s, 40.3 s, 37.8 s.
- Post-run `git worktree list` shows only the 6 persistent harness
  worktrees (`develop`, `FIX-001`, `INTEGRATE-FLOW-003`, `ISSUE-001`,
  `ISSUE-002`, `PERF-005`); **zero** `pi-team/test-runtime-*` entries.
- Post-run `git branch --list 'pi-team/test-runtime-*'` is empty.
- Post-run `Get-Process powershell,cmd,WindowsTerminal,OpenConsole |
  Where-Object StartTime -gt (Get-Date).AddMinutes(-5)` reports only
  the Reviewer's own transient shells (parent `node`, started within
  the script execution window). None bear a `fake-pi` identity, none
  open a window (`MainWindowTitle` empty).
- The `setup is isolated, pinned, idempotent …` test (line 326), which
  uses its own `fake-pi.ps1` synchronous installer stub and never
  calls `Start-Process`, still passes (8.3 s, no observable change).

Visible-window elimination is mechanical: `Start-Process fake-pi.cmd
-WindowStyle Hidden` (now) + `start "" /b powershell.exe … >nul 2>&1`
followed by immediate `exit /b 0` (in `fake-pi.cmd`) closes the
console-subsystem cmd.exe wrapper before the window can settle, and
the bootstrap powershell.exe inherits the (already-hidden) console.

Residue elimination is mechanical: each role's runtime JSON now records
`process_chain` (innermost first), and the test `finally` block iterates
over `runtime.process_chain ∪ {runtime.runtime_pid}` and calls
`taskkill /PID <pid> /T /F` synchronously. `taskkill /T` cascades to
the entire recorded tree; the test no longer relies on empirical timing.

## 5. Existing test semantics preserved

Re-read every assertion in `tests/team-contract.test.mjs` from line 326
to line 700 and ran the suite five times. All pre-existing assertions
hold:

- `start` produces two records (executor + reviewer) with `--no-extensions`,
  `--no-skills`, `--tools <expected>`, `--session-id`, `--skill <expected>`,
  no `--agent`, no Lead-only tokens, no other-role delegation ids,
  distinct agent IDs, expected `state_root`, no contract path,
  no worktree-snapshot extension path. (Issue #1 contract invariants
  preserved.)
- `research` produces one record with `--no-extensions`, `--no-skills`,
  `--tools RESEARCHER_TOOLS`, no `--session-id`, distinct agent IDs.
- `resume` produces two records with `--session`, no `--session-id`,
  `--no-extensions`, reusing the original agent IDs and session IDs.
- `process_chain` recording adds one new assertion (each role's runtime
  JSON's `process_chain` is a non-empty array containing
  `runtime_pid`). It is a **strictly additional** check and cannot
  mask a regression; if the chain walk or recording breaks, this
  assertion fails.

Setup test uses its own fixture (`fakePi` = `root/fake-pi.ps1`,
synchronous installer stub), so the watchdog and `process_chain`
additions do not affect it.

## 6. Real `wt.exe` product behavior boundary

Re-confirmed via static inspection of `scripts/pi-team.ps1`:

- The conditional only fires when `$env:WT_CMD` is set AND the
  executable path does **not** match `(?i)(^|[\\/])wt(\.exe)?$`.
- `Stop-RoleTree` (line 275) is unchanged.
- Launch arguments (`-d <worktree> powershell.exe -NoLogo -NoProfile
  -ExecutionPolicy Bypass -EncodedCommand <encoded>`) are unchanged.
- The production process tree
  `wt.exe → OpenConsole → powershell.exe → cmd.exe → pi.cmd → node.exe`
  is unchanged.
- `Get-Command wt.exe` (line 371 default) resolves to the real binary;
  the regex matches; `$windowStyle` is `Normal`.

A production caller (no `$env:WT_CMD`) cannot accidentally land on the
`Hidden` branch.

## 7. Failed-startup cleanup

`Start-Task`'s catch (line 389–390) still calls `Stop-RoleTree`,
which `taskkill /T /F`s `launcher_pid` and `runtime_pid`. With the
new test `finally` cleanup, the test no longer needs the 750 ms
sleep — the deterministic `taskkill /T /F` on `process_chain`
guarantees the entire fake tree is reaped before `git worktree
remove --force`. The watchdog (`PI_TEAM_FAKE_TIMEOUT_SEC`, default
15 s) is the second line of defense if `taskkill` is somehow skipped.

Note on the 100 ms post-kill delay: the new `finally` block waits 100 ms
(only when at least one PID was killed) before invoking `git worktree
remove --force`. 5 consecutive runs observed zero `git worktree remove`
failures; the 100 ms was empirically sufficient on the Reviewer's
Windows host. If a slower host ever surfaces a flake, the watchdog
catches the orphan before it can outlive the test.

## 8. Remaining risks (noted, not blocking)

These are documented in `implementation_notes/ISSUE-002.md` and
verified by the Reviewer to be acceptable for this slice:

- `Get-CimInstance Win32_Process` adds ~50–100 ms per fake launch on
  cold WMI cache. The role-launchers test absorbed this; total runtime
  remained ~23 s.
- The watchdog `Elapsed` action runs in the foreground `Elapsed` event
  handler; if the timer fires while the script is mid-exit, the
  `Stop-Process -Id $PID -Force` is harmless on an already-exiting
  process.
- The `process_chain` walk is capped at 16 levels. The role-launchers
  test's deepest chain observed in this run was ~7 PIDs; the cap is
  comfortable.
- The conditional is a single-line string comparison. A future test
  that names its launcher `wt.exe` (matching the regex) will not get
  the `Hidden` window style — by design, that test would then need its
  own `.cmd` wrapper (matching the existing pattern).

None of these change the verdict.

## 9. Files inspected

| Path | Purpose |
| --- | --- |
| `plans/ISSUE-002-task.md` | Lead task contract (C-003 read) |
| `research/ISSUE-002-empty-terminal-paths.md` | Researcher diagnosis (cross-check) |
| `implementation_notes/ISSUE-002.md` | Executor's implementation notes |
| `reports/ISSUE-002-verification.md` | Executor's verification report |
| `scripts/pi-team.ps1` (lines 270–390) | Production code change scope |
| `tests/team-contract.test.mjs` (lines 326–700) | Test change scope |
| `tests/run-tests.ps1` (unchanged) | Confirmed not touched |
| `tests/communication-policy.test.mjs` (unchanged) | Confirmed not touched |
| `tests/blackboard.test.mjs` (unchanged) | Confirmed not touched |
| `.tmp/test-regex.ps1` | Reviewer-written regex probe (transient) |
| `.tmp/stress-test.ps1` | Reviewer-written 5-run stress test (transient) |
| `.tmp/check-residue.ps1` | Reviewer-written post-run residue check (transient) |

## 10. Reproduction commands used by the Reviewer

```powershell
# Single full run
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1

# Stress (5 runs, captured in .tmp/stress-test.ps1)
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .tmp/stress-test.ps1

# Residue snapshot (captured in .tmp/check-residue.ps1)
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .tmp/check-residue.ps1

# Regex probe (captured in .tmp/test-regex.ps1)
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .tmp/test-regex.ps1

# Diff scope
git diff --stat HEAD
git diff HEAD
```

All commands native Windows PowerShell; no WSL used.

## Reviewer recommendation to Lead

`C-003` is satisfied. The Executor addressed the Lead objective (test-side
fix, no scope drift) and the Researcher's diagnosis (no visible console
windows, no residue, real-wt.exe boundary preserved). Accept the slice
when Lead is satisfied with `C-002` and `C-004` re-checks.
