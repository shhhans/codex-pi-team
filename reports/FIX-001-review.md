# FIX-001 — Reviewer Independent Review

- Lead task ID: **FIX-001**
- Delegation: **REVIEW-FIX-001**
- Worktree: `D:/Coding/Harness/Pi-team-FIX-001`
- Branch: `pi-team/FIX-001-issue-2-empty-terminals` (base ref `master`)
- Paired Executor: `pi-team--FIX-001--executor`
- Companion artifacts:
  - `implementation_notes/FIX-001.md` (Executor slice log)
  - `reports/FIX-001-verification.md` (Executor verification report)
- Slice state: **REVIEW_PASS**

---

## 1. Diff scope (against `master`)

`git diff --stat master`:

```
 scripts/pi-team.ps1          |  8 ++++++-
 tests/team-contract.test.mjs | 50 +++++++++++++++++++++++++++++++++++++++++-
 2 files changed, 56 insertions(+), 2 deletions(-)
```

`git status --porcelain`:

```
 M scripts/pi-team.ps1
 M tests/team-contract.test.mjs
 ?? implementation_notes/FIX-001.md
 ?? reports/FIX-001-verification.md
```

Both file paths are in the in-scope list of the contract. No other paths
modified. No `.tmp/` scratch residue. Branch HEAD equals master
`c541f63` (the Lead pre-created the branch from `master` and no commits
were added on top, per the contract constraint).

The git reflog shows only the initial `reset: moving to HEAD` and no
subsequent commit / stash / reset / checkout / rebase / cleanup —
constraint compliance confirmed.

---

## 2. Independent Issue #2 root-cause verification

### 2.1 Trigger path

`scripts/pi-team.ps1` `Start-RoleProcess` was the single unconditional
`-WindowStyle Normal` line. It is invoked from `Launch-Role` for every
role launch (`executor`, `reviewer`, optional `researcher`). When the
test suite runs `tests/run-tests.ps1`:

1. `tests/team-contract.test.mjs` builds `fake-pi.cmd`:
   ```
   @echo off
   powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-pi.ps1" %*
   ```
2. The same test sets `WT_CMD=fake-pi.cmd`, so
   `Start-Process -FilePath fake-pi.cmd -WindowStyle Normal` spawns a
   visible `cmd.exe` console to host the `.cmd` script.
3. The console window contains no content the user can read — the actual
   role launch (the encoded bootstrap) happens inside the
   `powershell.exe -File fake-pi.ps1` child process, which exits
   immediately after writing its runtime file. The `cmd.exe` wrapper
   remains for the duration of the synchronous `Launch-Role` call and
   flashes an empty Terminal to the user.

That matches Issue #2 ("测试运行时弹出空 Terminal").

### 2.2 Other tests do not exercise this path

`tests/run-tests.ps1` invokes three suites:

- `tests/team-contract.test.mjs` — only the launcher test ("role launchers
  inject common-dir identity and isolate Executor/Reviewer environments")
  calls `Start-RoleProcess`. This is the test the fix targets.
- `tests/communication-policy.test.mjs` — pure unit tests of the policy
  module; no `Start-Process` invocation.
- `tests/blackboard.test.mjs` — pure unit tests of the Blackboard
  module; no `Start-Process` invocation.

So the env var is needed only inside the one launcher test, which is
where the Executor set it. This is correctly scoped.

### 2.3 Why the default branch stays `'Normal'`

In `scripts/pi-team.ps1`:

```powershell
$windowStyle = if ($env:PI_TEAM_TEST_NO_WINDOW -eq '1') { 'Hidden' } else { 'Normal' }
return Start-Process $Executable -WorkingDirectory $WorkingDirectory -ArgumentList $commandLine -WindowStyle $windowStyle -PassThru
```

When `$env:PI_TEAM_TEST_NO_WINDOW` is unset (production) or set to any
value other than `'1'` (PowerShell `-eq` is case-insensitive on strings
so `'1'`, `'1'`, `'1'` all match — but the contract specifies `=1`),
`$windowStyle` is `'Normal'`, which is byte-identical to the pre-fix
`-WindowStyle Normal -PassThru` invocation. The contract constraint
"修复必须保持真实 wt.exe 角色 Terminal 的产品可见行为不变" is satisfied
by static equivalence: the default branch is the same literal argument
that production has always used.

---

## 3. Independent validation reproduction

### 3.1 Full suite

```
$ powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1
…
ℹ tests 42
ℹ pass 42
ℹ fail 0
� duration_ms 20137.0883
```

42/42 pass, 0 fail. Exit code 0. Matches Executor's claim.

### 3.2 Team-contract only

```
$ node --test tests/team-contract.test.mjs
…
ℹ tests 20
ℹ pass 20
ℹ fail 0
```

The launcher test alone takes 12.8 s because the new retry-loop
PID-cleanup assertion waits up to 5 s per PID on busy hosts; this is the
documented behavior of the assertion.

### 3.3 Process snapshot after the suite

After running `tests/run-tests.ps1` and inspecting all `powershell`,
`cmd`, `wt`, and `WindowsTerminal` processes:

| Id   | ProcessName     | MainWindowTitle                 |
| ---: | --------------- | ------------------------------- |
| 26276| WindowsTerminal | (the FIX-001 Executor pane)     |

15 powershell/cmd/wt/WindowsTerminal processes were running, but only
one had a `MainWindowTitle`: the production FIX-001 Executor pane
(WindowsTerminal PID 26276). No `cmd.exe` or `powershell.exe` had a
visible window. None of the processes were a fake launcher residue from
the test suite.

Note: the FIX-001 Executor pane is the production role launched for
**this Lead assignment**, not a test artifact. It is the role the
Reviewer is intentionally keeping alive per the constraint "Lead 验收
前保持 pair 存活".

### 3.4 Test semantic preservation

Reading `tests/team-contract.test.mjs` against master:

- The existing assertions on start / research / resume / agent IDs /
  session IDs / tool lists / state-file structure / runtime-file paths /
  environment isolation / `extraEnv` precedence / rejection of unknown
  capability are all intact.
- The added code is in two places:
  1. The `run(...)` helper now spreads `baseTestEnv` (`PI_TEAM_TEST_NO_WINDOW: "1"`)
     before `extraEnv`. This preserves the existing `extraEnv`-wins
     precedence.
  2. The `finally` block captures tracked PIDs from the state file
     before deletion, then runs a 20 × 250 ms bounded retry that
     asserts each PID is gone via `Get-Process`. This is additive and
     does not modify any existing assertion.

The test semantic contract from C-002 ("保持测试覆盖的启动、research、
resume、超时和参数边界语义") is preserved.

---

## 4. Test correctness — could the assertion be a false pass?

The retry loop queries `Get-Process -Id <pid> -ErrorAction SilentlyContinue`
and asserts the result equals `'gone'`. This query is per-PID and uses
the recorded PIDs from the test's own state file, so it is immune to
the host's background Pi Team activity (other Launch-Role sessions from
parallel worktrees). A flake would manifest as an `Issue #2: PID …
must exit` assertion failure, not a silent false pass. The Executor
notes that earlier non-retrying versions produced ~2/10 flake; the
20 × 250 ms budget absorbs the observed 250–1250 ms Windows process
teardown variance. 10/10 success confirms the budget is sufficient on
this host.

This is a deterministic, host-independent check for "no test-owned
residual PID" and is the right shape for C-004 #3.

---

## 5. Real-path contract preservation

| Production path | Pre-fix behavior | Post-fix behavior (env var unset) | Match |
| --- | --- | --- | --- |
| `Start-Process $wt.exe ... -WindowStyle Normal -PassThru` | visible wt.exe Terminal | `-WindowStyle 'Normal' -PassThru` | yes (byte-identical) |
| `Start-Process $wt.exe ... -WindowStyle Normal -PassThru` with env `PI_TEAM_TEST_NO_WINDOW=1` | n/a (production never sets) | `-WindowStyle 'Hidden' -PassThru` | n/a (test-only branch) |
| `Stop-RoleTree $Session` (`taskkill.exe /PID /T /F`) | unchanged | unchanged | yes (not modified) |
| `Launch-Role` env-var identity setup (`try/finally` restore) | unchanged | unchanged | yes (not modified) |

The production `wt.exe` window visibility contract is preserved. The
constraint "修复必须保持真实 wt.exe 角色 Terminal 的产品可见行为不变" is
satisfied by static equivalence and by the absence of any production-
path change.

---

## 6. Observability and honesty

The Executor's verification report distinguishes 观测值 (42/42 pass,
10/10 pass, 20/20 isolated pass, default branch byte-identical),
推断 (Start-Process -WindowStyle Hidden documents as SW_HIDE), and
待测 (direct Win32 EnumWindows capture was skipped because the host's
concurrent Pi Team sessions make window enumeration unreliable).

This honesty is appropriate. The static diff and the per-PID dynamic
check together satisfy C-002 and C-004 without claiming window
enumeration evidence that the host cannot produce cleanly. No evidence
is fabricated.

---

## 7. Findings

### Real failures
None. All assertions in the modified test pass deterministically. The
default-branch behavior matches the pre-fix behavior exactly. No
unrelated edits, no scope creep, no constraint violation.

### Notes for Lead (informational, not failures)

1. **C-001 deliverable absent**: `research/FIX-001-window-path.md` is
   not present in `research/`. C-001 is the Researcher's done criterion.
   The Executor's own verification (`reports/FIX-001-verification.md`)
   independently establishes the root cause and the static evidence, so
   C-002 / C-003 / C-004 are not blocked. Lead may want to confirm the
   Researcher pair was launched and what its `READY_FOR_REVIEW` state
   is — if it was never launched, C-001 closure is the Researcher's
   responsibility, not the Executor's.

2. **`reports/FIX-001-verification.md` mentions a scratch file**:
   ".tmp/run-10-times.ps1" was used and then removed. Confirmed by
   `ls .tmp` returning `PathNotFound` after the suite.

3. **Process-state baseline noise**: the test's "no-residual-window"
   claim is checked per-PID against the test's own state file, not
   against a `Get-Process | Group` snapshot. This is the correct
   choice given that the host has concurrent Lead worktrees (e.g.
   PERF-005) whose role processes would otherwise pollute a global
   snapshot. The Executor's note correctly explains this trade-off.

### Architectural or product decisions
None. The fix is a single conditional in `Start-RoleProcess` keyed off
an opt-in env var; no design decisions surface.

---

## 8. Reviewer decision

**REVIEW_PASS.**

- C-002: Executor implemented the minimal test-side fix; start /
  research / resume / parameter semantics preserved; no extra visible
  Terminal; no residual fake launcher process (validated by 42/42 +
  20/20 + per-PID assertion).
- C-003: Reviewer independently confirmed the root cause (unconditional
  `-WindowStyle Normal` in `Start-RoleProcess`), reproduced the test
  results, verified the diff is minimal and within scope, and
  confirmed the production `wt.exe` path is byte-identical to master
  when the env var is unset.
- C-004: Lead can reproduce with `powershell.exe -NoLogo -NoProfile
  -ExecutionPolicy Bypass -File tests/run-tests.ps1`; expected tail
  `tests 42 / pass 42 / fail 0`; fake launcher uses `-WindowStyle
  Hidden` via `PI_TEAM_TEST_NO_WINDOW=1`; per-PID assertion enforces no
  test-owned residual PID; production window visibility preserved by
  default-branch equivalence.

No `failures/FIX-001-*.md` artifact is required.

Pair remains idle for Lead acceptance.
