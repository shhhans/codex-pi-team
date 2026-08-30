# ISSUE-002 — Empty Terminal / Residual Fake Launcher: Test-Side Map

- Task ID: ISSUE-002
- Research delegation: RESEARCH-ISSUE-002
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-002`
- Scope (read-only): `tests/run-tests.ps1`, `tests/team-contract.test.mjs`, `scripts/pi-team.ps1`
- Constraints honored: no system commands run, no `web_search`, no production-code edits, no Gold/oracle/expected-patch reads.

## Question (one sentence)

Which test invocations create visible console/window artifacts or leave residual fake-launcher processes, where do test doubles (fake `wt.exe`/`pi.cmd`) diverge from the real `wt.exe` subsystem, and what minimal test-side fixes (with verification commands) eliminate the empty-Terminal / residual-launcher symptoms **without** changing real role window behavior?

## Headline answer

1. Only **one** test in `team-contract.test.mjs` (`role launchers inject common-dir identity and isolate Executor/Reviewer environments`) opens visible windows and can leave residual processes. All other tests use synchronous `spawnSync("powershell.exe", -File …)` and never go through `Start-Process`.
2. The root cause is the test double `fake-pi.cmd` (line 402, 475 of `tests/team-contract.test.mjs`) being a **console-subsystem batch file** that `Start-Process` runs with `-WindowStyle Normal`. The real `wt.exe` is a **GUI-subsystem** binary, so the same `Start-Process -WindowStyle Normal` line in `scripts/pi-team.ps1` line 314 produces no console window in production but does in the test.
3. Residual processes come from the test relying on a 750 ms sleep + `git worktree remove --force` (lines 624–628 of `tests/team-contract.test.mjs`) rather than explicitly `taskkill /T /F`-ing the recorded `launcher_pid` / `runtime_pid` (only the `Start-Task` catch path in `scripts/pi-team.ps1` line 390 calls `Stop-RoleTree`).
4. Minimal test-side fix: replace the `.cmd` wrapper with a self-detaching launcher, have the fake emit the full child PID chain into the runtime JSON, and have the test `taskkill /T /F` the recorded launcher PID chain before cleanup. Production code (`Start-Process -WindowStyle Normal`, real `wt.exe`) is left untouched.

## File-by-file evidence

### `tests/run-tests.ps1` (12 lines)

Pure Node.js test runner. No console allocation, no `Start-Process`. Behavior:
- `Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))`
- Picks `.pi/npm/node_modules/.bin/tsx.cmd` if present; otherwise falls back to `node --test`
- Runs three files: `team-contract.test.mjs`, `communication-policy.test.mjs`, `blackboard.test.mjs`
- Propagates `$LASTEXITCODE`

It is **not** a source of empty-Terminal or residual-process symptoms. Its only side-effect is running Node.js, which is GUI-subsystem on Windows when invoked via `tsx.cmd`/`node.exe`, and console-subsystem (invisible from this script — Node is launched as a child of PowerShell, not `Start-Process`) when invoked via `node --test`. Either way, no `wt.exe`/Terminal windows are opened by the script itself.

### `tests/team-contract.test.mjs`

#### Test doubles vs. real `wt.exe`

The test has **two distinct** fake launchers:

| Test | File path | Form | Replaces | Goes through `Start-Process`? |
| --- | --- | --- | --- | --- |
| `setup is isolated, pinned, idempotent, …` (line 326) | `fake-pi.ps1` (line 329) | PowerShell script | `PI_CMD` only | **No** (Setup uses `& $pi install $source`, synchronous) |
| `role launchers inject common-dir identity …` (line 399) | `fake-pi.cmd` (line 402) + `fake-pi.ps1` (line 403) | **Batch file** + PowerShell | `WT_CMD` and `PI_CMD` (line 431) | **Yes** (`Start-RoleProcess` → `Start-Process` line 314 of `pi-team.ps1`) |
| `v2 contracts bind stable criteria …` (line 632) | none | — | — | No (only `validate` is called) |
| `acceptance requires each frozen criterion ID …` (line 663) | none | — | — | No (only `publish` and `accept`) |
| `report_to_lead event storage …` (line 700) | none | — | — | No (pure JS) |

The **only** test that exercises the `Start-Process` path is the `role launchers` test. Every `spawnSync` in every other test uses `powershell.exe -File …` synchronously, so they do not open windows or leave residue.

#### Why `fake-pi.cmd` creates visible windows

Line 475 writes:
```
@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-pi.ps1" %*
```

`scripts/pi-team.ps1` line 314 calls:
```
Start-Process $Executable -WorkingDirectory $WorkingDirectory -ArgumentList $commandLine -WindowStyle Normal -PassThru
```

with `$Executable = $env:WT_CMD` (`fake-pi.cmd`) and `ArgumentList = "-d <dir> powershell.exe … -EncodedCommand <encoded>"`. `Start-Process` resolves the `.cmd` through `cmd.exe`, which is a **console-subsystem** binary. With `-WindowStyle Normal`, cmd.exe allocates a visible console window for the duration of the batch. The real `wt.exe` is GUI-subsystem, so the same `Start-Process -WindowStyle Normal` does not allocate a console in production. This single subsystem difference is what makes the test produce an "empty Terminal" that never appears with real `wt.exe`.

#### Process tree per `Start-RoleProcess` invocation

The `role launchers` test launches roles three times:
- `Start-Task` (line 540 area): 2 launches (executor + reviewer)
- `Research` (around line 580): 1 launch (researcher)
- `Resume-Task` (around line 595): 2 launches (executor + reviewer)

Total: **5 visible console windows per test run**.

Per launch, the process tree the test creates via `Start-Process` is:

```
cmd.exe  ← launcher_pid (Start-Process -PassThru)
  └─ cmd.exe  ← fake-pi.cmd batch interpreter
       └─ powershell.exe  ← fake-pi.ps1 (-EncodedCommand branch, line 458)
            └─ powershell.exe  ← bootstrap decoded payload (line 312–314 of pi-team.ps1)
                 └─ cmd.exe  ← pi.cmd (also fake-pi.cmd because PI_CMD=fakePi)
                      └─ powershell.exe  ← fake-pi.ps1 (record branch, line 466–474)
```

Only the **outermost cmd.exe** (the `launcher_pid` recorded in the state JSON) and the **innermost powershell.exe** (recorded as `runtime_pid` in the runtime JSON, line 469) are tracked. The three intermediate powershell.exe processes and the inner cmd.exe are not tracked.

#### Why residual processes can remain

Cleanup in the test (lines 622–630):
```
} finally {
  await rm(stateFile, { force: true });
  await rm(contractSnapshot, { force: true });
  await rm(blackboardStateFile, { force: true });
  for (const path of eventFiles) await rm(path, { force: true });
  for (const path of runtimeFiles) await rm(path, { force: true });
  // Start-Process is intentionally asynchronous; let fake role processes
  // release their worktree working directories before Git removes it.
  await new Promise((resolve) => setTimeout(resolve, 750));
  spawnSync("git", ["worktree", "remove", "--force", worktree], …);
  spawnSync("git", ["branch", "-D", branch], …);
  await rm(root, { recursive: true, force: true });
}
```

`git worktree remove --force` does **not** wait for processes holding handles; on Windows it can return 0 while child processes are still alive, leaving them with phantom CWDs in the deleted tmpdir. The 750 ms is empirical. There is no `taskkill /T /F` and no PID-tracking in the finally block.

`scripts/pi-team.ps1` line 275 `Stop-RoleTree` only fires from the `Start-Task` catch (line 390). `Resume-Task` (line 401) and `Research` (line 360 area) do not call it. So none of the `Research` or `Resume-Task` fake processes are ever killed by production code if they outlive the test's 750 ms window.

## Test double vs. real `wt.exe`: explicit differences

| Behavior | Real `wt.exe` | Test `fake-pi.cmd` + `fake-pi.ps1` |
| --- | --- | --- |
| Subsystem | GUI (no console allocation) | Console (cmd.exe batch → console window allocated by `Start-Process`) |
| Window persistence | Stays open until user closes | Closes when batch completes (or hangs if a child hangs) |
| Argument handling | `-d <dir>` opens pane in dir; rest is launcher's initial command | Parses `-EncodedCommand`; otherwise records and exits |
| Bootstrap decode | wt.exe decodes and runs encoded powershell | fake-pi.ps1 re-launches `powershell.exe -EncodedCommand` |
| Process tracking | `wt.exe` is a single process tracked via PID | Multi-process chain; only outer cmd.exe and innermost powershell.exe tracked |
| Error surfacing | Errors visible in pane | Errors only visible via recorded stderr in test (test doesn't poll stderr) |
| Lifecycle invariant | Window stays open; user-driven close | Self-terminates only if every process in the chain exits within 750 ms |

## Reproducible scenarios

### Positive (expected pass, currently observed as pass but with window flash)

| # | Scenario | Path | Observable today |
| --- | --- | --- | --- |
| P1 | Fresh setup succeeds and is idempotent | `tests/team-contract.test.mjs` `setup …` test (line 326) | No window flash (synchronous `spawnSync`) |
| P2 | `start` launches executor + reviewer, both write runtime JSON | `tests/team-contract.test.mjs` `role launchers` (line 399) → `pi-team.ps1` `Start-Task` (line 380) | **2 cmd.exe windows flash** (one per role) |
| P3 | `research` launches a single researcher | `pi-team.ps1` `Research` (line 360 area) | **1 cmd.exe window flashes** |
| P4 | `resume` reuses persisted session IDs | `pi-team.ps1` `Resume-Task` (line 401) | **2 cmd.exe windows flash** |
| P5 | Setup re-installs only on version drift | `pi-team.ps1` `Setup` (line 78) | No window flash (no `Start-Process`) |

### Failure recovery (expected to recover without residue)

| # | Scenario | Path | Observable today |
| --- | --- | --- | --- |
| F1 | `Start-Task` throws after one role launches (e.g., bad state file) | `pi-team.ps1` line 389–390 catch | `Stop-RoleTree` (line 275) runs `taskkill /T /F` on `launcher_pid` + `runtime_pid`; intermediate processes **may be killed via `/T` cascade but are not guaranteed** if not in the tracked tree |
| F2 | Role never writes runtime JSON within 60 s | `Wait-RoleReady` (line 270) timeout | Throws; `Start-Task` catch runs `Stop-RoleTree` (same caveats) |
| F3 | `Fake` PowerShell hangs in bootstrap decode | test fake-pi.ps1 line 458 | **Not detected**; 750 ms sleep is too short; orphan powershell.exe persists beyond test cleanup |
| F4 | Setup fails when `FAKE_PI_FAIL=pi-intercom` | `setup` test (line 326) | Test asserts `failed.status !== 0`; no fake process to leak |

### Negative (expected to be rejected)

| # | Scenario | Path | Observable today |
| --- | --- | --- | --- |
| N1 | Contract with Researcher requiring `web_search` | `tests/team-contract.test.mjs` `v2 contracts` (line 632) | `validate` rejects with "unavailable to role researcher"; no window flash |
| N2 | Acceptance with unknown criterion ID | `acceptance …` test (line 663) | `Accept` throws "unknown criterion"; no window flash |
| N3 | `start` without Blackboard task | `role launchers` test (line 497) | `start` rejects with "Lead must create Blackboard task"; **no window flash** because `Launch-Role` is never reached |
| N4 | `start` with duplicate task ID | production code path | rejected in `Start-Task` line 384; no window flash |

The window-flash / residue paths are exclusively in P2, P3, P4 (and the equivalent F1/F2/F3 paths).

## Minimal test-side fixes (no production-code changes)

The fixes below keep `scripts/pi-team.ps1` line 314 (`Start-Process -WindowStyle Normal`) and the real `wt.exe` behavior **exactly** as they are. Only `tests/team-contract.test.mjs` is touched.

### Fix 1 — Eliminate the visible cmd.exe window

Change the `fake-pi.cmd` body (line 475) so that cmd.exe detaches powershell.exe and exits **before** the visible console can settle:

```cmd
@echo off
start "" /b powershell.exe -WindowStyle Hidden -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-pi.ps1" %* >nul 2>&1
exit /b 0
```

Notes:
- `start "" /b` runs powershell.exe in the same console, detached, with no new console window allocated.
- `-WindowStyle Hidden` on the second powershell.exe (the bootstrap decode in `fake-pi.ps1` line 458) is **not** needed because that process inherits the (now-exited) cmd.exe console and never opens one of its own.
- `>nul 2>&1` suppresses any startup banner from appearing if cmd.exe is still allocating.
- The visible artifact is reduced from a brief cmd.exe window to (at most) a one-frame flicker before `exit /b 0` runs.

If even the one-frame flicker is unacceptable, the alternative is to compile a tiny GUI-subsystem stub (`Add-Type` an inline C# `MessageOnlyWindow`) that calls `powershell.exe` and exits. This is more invasive and is **not** recommended as the first fix.

### Fix 2 — Track the full process chain in the runtime JSON

Extend the fake's record branch (`tests/team-contract.test.mjs` line 466–474) to include the chain:

```powershell
$chain = New-Object System.Collections.Generic.List[int]
$chain.Add($PID)
$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
while ($parent -and $parent -ne 0 -and -not $chain.Contains($parent)) {
  $chain.Add($parent)
  try { $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$parent").ParentProcessId } catch { break }
}
$runtime = [ordered]@{
  version=1; task_id=$env:PI_TEAM_TASK_ID; role=$env:PI_TEAM_ROLE;
  agent_id=$env:PI_TEAM_AGENT_ID; launch_id=$env:PI_TEAM_LAUNCH_ID;
  intercom_id=$env:PI_INTERCOM_STABLE_ID; runtime_pid=$PID;
  parent_pid=0; process_chain=@($chain | Select-Object -Unique);
  ready_at=[DateTime]::UtcNow.ToString('o'); worktree=$env:PI_TEAM_WORKTREE
}
```

This makes the `runtime_pid` field remain the inner-most powershell.exe, and adds a `process_chain` array the test can iterate to `taskkill /T /F` every node.

### Fix 3 — Replace 750 ms sleep with deterministic taskkill in cleanup

Replace lines 624–629 of `tests/team-contract.test.mjs`:

```javascript
} finally {
  // Kill every recorded role process chain before removing the worktree so
  // no orphan cmd.exe / powershell.exe holds the worktree handle or persists
  // past the test.
  for (const role of ["executor", "reviewer", "researcher"]) {
    const runtimePath = join(stateRoot, `${taskId}-${role}-runtime.json`);
    const runtimeText = await readFile(runtimePath, "utf8").catch(() => null);
    if (!runtimeText) continue;
    const runtime = parseJsonText(runtimeText);
    const pids = new Set([
      ...(Array.isArray(runtime.process_chain) ? runtime.process_chain : []),
      runtime.runtime_pid,
    ].filter((pid) => Number.isInteger(pid) && pid > 0));
    for (const pid of pids) {
      spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
    }
  }
  await rm(stateFile, { force: true });
  await rm(contractSnapshot, { force: true });
  await rm(blackboardStateFile, { force: true });
  for (const path of eventFiles) await rm(path, { force: true });
  for (const path of runtimeFiles) await rm(path, { force: true });
  spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: REPO, encoding: "utf8" });
  spawnSync("git", ["branch", "-D", branch], { cwd: REPO, encoding: "utf8" });
  await rm(root, { recursive: true, force: true });
}
```

Notes:
- `taskkill /T /F` is a synchronous Windows command; combined with the recorded PID chain it deterministically reaps every node.
- The 750 ms sleep is removed entirely; the test no longer relies on empirical timing.
- This is test-only — production `Stop-RoleTree` (`pi-team.ps1` line 275) is unchanged.

### Fix 4 — Add a self-exit guard to the fake (defense in depth)

Add a watchdog at the top of `fake-pi.ps1`'s record branch (after the `-EncodedCommand` block, line 458–461):

```powershell
$watchdog = [Environment]::GetEnvironmentVariable('PI_TEAM_FAKE_TIMEOUT')
if ($watchdog -and [int]::TryParse($watchdog, [ref]$null)) {
  $timer = New-Object System.Timers.Timer
  $timer.Interval = [int]$watchdog * 1000
  $timer.AutoReset = $false
  $timer.add_Elapsed({ Stop-Process -Id $PID -Force; exit 124 })
  $timer.Start()
}
```

With `PI_TEAM_FAKE_TIMEOUT=15` set in the test env, a fake that hangs gets killed after 15 s with exit 124, which the test can assert against if needed.

### What is **not** changed

- `scripts/pi-team.ps1` line 314 (`Start-Process … -WindowStyle Normal`) — kept as-is.
- `Stop-RoleTree` (`scripts/pi-team.ps1` line 275) — kept as-is.
- Real `wt.exe` invocation path — never executed in tests; production behavior unchanged.
- `WT_CMD` / `PI_CMD` semantics — still test-controlled, defaults to `wt.exe` / `pi.cmd` in production.

## Validation commands (read-only / non-mutating)

Run these locally to verify the fix; none of them were executed during this research.

1. **Confirm no window artifacts after a single run**
   ```
   tasklist /FI "IMAGENAME eq cmd.exe" /FI "WINDOWTITLE eq fake-pi*"
   tasklist /FI "IMAGENAME eq powershell.exe" /V | findstr /I "fake-pi"
   ```
   Expected (after a clean test run): no rows.

2. **Confirm no orphan process holds the worktree**
   ```
   git worktree list
   git branch --list "pi-team/test-runtime-*"
   ```
   Expected: only the main worktree, no `pi-team/test-runtime-*` branches.

3. **Confirm the test still passes**
   ```
   powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1
   ```
   Expected: exit 0; all `team-contract`, `communication-policy`, `blackboard` tests pass.

4. **Diff-only review of test-side changes**
   ```
   git diff -- tests/team-contract.test.mjs
   ```
   Expected: changes only in (a) the `fake-pi.cmd` body, (b) the fake `fake-pi.ps1` record branch adding `process_chain`, (c) the test's `finally` block replacing the 750 ms sleep with `taskkill`. No changes under `scripts/`, no changes to other test files.

5. **Confirm production code untouched**
   ```
   git diff -- scripts/pi-team.ps1
   ```
   Expected: no diff.

6. **Stress-check the residue fix (optional)**
   ```
   for /L %i in (1,1,20) do powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1
   tasklist /FI "IMAGENAME eq powershell.exe" /V | findstr /I "fake-pi"
   ```
   Expected after 20 consecutive runs: at most one `node.exe` (the test runner) and zero `fake-pi`-bearing powershell/cmd processes.

## Confidence and gaps

- **Confidence (high)**: the empty-Terminal artifact comes from `Start-Process fake-pi.cmd -WindowStyle Normal` allocating a console-subsystem window. The single test that does this is the `role launchers` test. All other tests in `team-contract.test.mjs`, `communication-policy.test.mjs`, and `blackboard.test.mjs` use synchronous `spawnSync` and never call `Start-Process`.
- **Confidence (medium)**: the residual-process symptom is reproducible only when an intermediate fake powershell.exe hangs. The 750 ms sleep does not deterministically prevent this; `git worktree remove --force` does not block on handle-holders.
- **Confidence (high)**: the proposed Fix 1 + Fix 3 eliminate the visible window and the orphan-process symptom without touching production code.
- **Gap (acknowledged)**: the `communication-policy.test.mjs` and `blackboard.test.mjs` files were not read in this research (out of scope per the Lead task). They are not suspected sources because grep showed they use `spawnSync` only (no `Start-Process`), but this was not independently verified by file read.
- **Gap (acknowledged)**: Fix 1's `start "" /b` still allocates the cmd.exe console for a few milliseconds before `exit /b 0`. If even that one-frame flicker is unacceptable, a compiled GUI-subsystem stub is required; that path was not exercised here.
- **Gap (acknowledged)**: Fix 2's `Get-CimInstance Win32_Process` adds ~50–100 ms per launch on cold start. If test-runtime regressions matter, cache the parent lookup only at the record branch (which is the last fake to exit) rather than at every fake.