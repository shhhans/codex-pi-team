# FIX-001 — Issue #2 window path analysis

- Lead task ID: **FIX-001**
- Research delegation: **RESEARCH-FIX-001**
- Question: identify the test calls that create visible console windows, separate the test wrapper, fake launcher, and real `wt.exe` path, and define the smallest safe test-side fix.

## Finding

The repeated empty windows are created by the `Start-Process` call in
`scripts/pi-team.ps1` when the launcher test substitutes `WT_CMD` with a
`.cmd` fake launcher. `tests/run-tests.ps1` is only the suite wrapper; it does
not itself create the windows. The safe boundary is to hide only the fake
launcher path during that test and retain the production default of
`-WindowStyle Normal` for real `wt.exe` launches.

## Call-path evidence

1. `tests/run-tests.ps1` invokes the Node test suites. It does not invoke
   `wt.exe`, `Start-Process`, or a fake launcher directly.
2. The setup/doctor test invokes `scripts/pi-team.ps1` synchronously with a
   fake `PI_CMD`; it does not enter `Launch-Role`/`Start-RoleProcess` and does
   not create a role console window.
3. The launcher contract test sets both `PI_CMD` and `WT_CMD` to
   `fake-pi.cmd`, then exercises `start`, `research`, and `resume`. Those
   paths enter `Launch-Role` and `Start-RoleProcess`.
4. Before FIX-001, `Start-RoleProcess` unconditionally used
   `Start-Process ... -WindowStyle Normal`. A `.cmd` fake launcher therefore
   created a visible `cmd.exe` console even though its child only wrote a
   runtime record and exited. The start/resume paths can create two such
   launchers each; the research path can create one.
5. The real production path uses `wt.exe`. Its default behavior must remain
   visible and is preserved by the FIX-001 conditional when
   `PI_TEAM_TEST_NO_WINDOW` is absent or differs from `1`.

## Safe fix and comparison

The minimal safe fix is the one present in this worktree:

- `scripts/pi-team.ps1` selects `Hidden` only when the explicit test-only
  environment switch `PI_TEAM_TEST_NO_WINDOW=1` is present; otherwise it
  selects the pre-existing `Normal` style.
- The launcher test supplies that switch for its fake `WT_CMD` invocations.
- The test additionally checks the recorded launcher/runtime PIDs after the
  normal teardown delay, so a hidden window cannot mask a leaked process.

Negative/control scenarios:

- Without the switch, the fake `.cmd` path follows the old visible-window
  behavior; this is the Issue #2 reproduction.
- With the switch, fake launchers are hidden while their lifecycle and
  arguments remain exercised.
- With the switch absent for a real production launch, the `wt.exe` path is
  unchanged and remains visible.

## Verification method

Run from the FIX-001 worktree:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1
node --test tests/team-contract.test.mjs
```

Expected results are exit code `0`, all deterministic tests passing, and no
test-owned launcher/runtime PID remaining after the bounded cleanup check.
The current implementation/review reports record the observed 42/42 suite,
20/20 contract suite, repeated-run results, and the production default-path
comparison. Direct Win32 window enumeration was not claimed because unrelated
Pi Team sessions make global window enumeration noisy; this remains a
follow-up measurement rather than fabricated evidence.

## Evidence boundary

The analysis is read-only and concerns only the three named paths. It does not
change the real role-terminal contract, does not inspect evaluation data, and
does not authorize a merge or cleanup operation.
