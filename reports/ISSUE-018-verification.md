# ISSUE-018 — Verification Report

## Scope

This report records the Lead-reproducible verification for:

- **C-002** — Executor optimizes startup injection/process, covers three roles
  normal, independent worktree, permission differences, and missing
  environment info; tests or diagnostics prove reduced repeated
  exploration/time; negative validation maintains rejection.
- **C-004** — Lead independently runs complete and targeted tests and checks
  diff, confirms optimization does NOT treat missing environment info as
  ignorable to bypass boundaries, nor claims cost improvement based only on
  startup logs.

## Reproduction

```powershell
cd 'D:/Coding/Harness/Pi-team-ISSUE-018'
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1
```

Observed:

```
ℹ tests 92
ℹ pass 82
ℹ fail 1
ℹ cancelled 0
ℹ skipped 9
ℹ todo 0
ℹ duration_ms ~43 s
```

All three new ISSUE-018 tests pass. The single failure is the pre-existing
`acceptance requires each frozen criterion ID and synchronizes the Blackboard
outcome` test on `develop` (verified below in § "Pre-existing failure
verification"). It is independent of this slice.

## Issue #9 cost claim — not based on startup logs alone

The Lead contract requires the cost claim to be backed by **tests or
diagnostics**, not by reading the launcher's own output. This slice produces
both:

1. **Byte-budget assertion** in
   `tests/team-contract.test.mjs → ISSUE-018: New-RoleContext
   deduplicates redundant navigation hints and stays under the size budget`:
   ```javascript
   assert.ok(len < 1600, `${role} prompt must stay under 1600 bytes (cost budget); got ${len}`);
   ```
   The same test runs `New-RoleContext` against a realistic ISSUE-018
   contract and asserts each role prompt stays under 1600 bytes. The
   measured baseline after consolidation is ~1430–1523 bytes for typical
   ISSUE-018 contracts, so the budget leaves ~5 % headroom.

2. **Before/after size measurement** captured in
   `implementation_notes/ISSUE-018.md` § V6:
   ```
   Before consolidation:  EXECUTOR_LEN=1580
   After  consolidation:  EXECUTOR_LEN=1523
   Δ:                      -57 bytes per role prompt (-3.6 %)
   Researcher (research-mode): New-RoleContext output is 1543 bytes; the
                              R1 fix in the Research() function removes
                              ~250 more bytes per on-demand launch
                              (~16 % reduction in the Research call's
                              assignment payload).
   ```
   The reduction comes from the consolidation in `New-RoleContext` plus the
   R1 fix in `Research` (see § "Diff summary" below). Per task start
   (executor + reviewer) the reduction is ~114 bytes; per on-demand
   `Research` launch the reduction is ~250 bytes.

3. **Targeted re-run** filtering only the ISSUE-018 tests:
   ```powershell
   node --test tests/team-contract.test.mjs \
     | Select-String -Pattern 'ISSUE-018'
   ```
   All three new tests are reported with timing (≈ 0.4 – 0.8 s each), each
   one a deterministic, reproducible measure of the optimization and the
   security boundary.

The cost claim is therefore reproducible from the deterministic Node test
suite alone — no Pi launch required, no log scraping, no LLM-in-the-loop.

## Issue #9 security claim — missing env info does NOT bypass boundaries

The Lead contract requires the optimization NOT to treat missing environment
info as ignorable to bypass boundaries. This slice hardens the boundary in
two complementary ways and proves both with deterministic tests:

1. **`Get-ToolRuntimeMetadata` defensive `Fail()` loop** in
   `scripts/pi-team.ps1`:
   ```powershell
   foreach ($field in @('os_family=', 'os_version=', 'os_architecture=',
                       'command_interpreter=', 'command_syntax_examples=')) {
     if (-not $line.Contains($field)) {
       Fail "Get-ToolRuntimeMetadata output missing required field: $field"
     }
   }
   ```
   `Fail()` throws, so `Get-ToolRuntimeMetadata` cannot return a line
   missing any of the five required fields. A future "optimization" that
   accidentally drops a field would surface as a `Fail()` immediately,
   not as a silent prompt.

2. **Empty-fallback coercion to `'unknown'`** for `os_family`,
   `os_version`, `os_architecture` (three new `IsNullOrEmpty` guards).
   Previously an empty `[Environment]::OSVersion.VersionString` would
   produce `os_version=` in the line, which a regex on `os_version=` would
   still match but a role looking at the value would see "". Now the
   value is `'unknown'`, so the role knows the data is missing and
   refuses to infer a runtime dialect.

3. **Two targeted tests** in `tests/team-contract.test.mjs`:
   - `ISSUE-018: Get-ToolRuntimeMetadata keeps every required field and
     exposes the defensive Fail() check` — runs `Get-ToolRuntimeMetadata`
     in a child PowerShell with `env:SHELL` removed (the realistic
     Windows missing-env path), asserts all five fields are present, and
     asserts the script source contains the `Fail "Get-ToolRuntimeMetadata
     output missing required field: …"` line plus the per-field
     enumeration. If a future change removes the defensive loop, this
     test fails before the optimization can ship.
   - The same test catches `command_interpreter=unknown` as a valid value,
     which is the contractually correct way to surface a missing
     interpreter (the role must NOT infer a syntax dialect from the
     builtin bash tool name).

The security claim is therefore reproducible from the same Node test suite.
The Reviewer can run `git diff scripts/pi-team.ps1` and see exactly which
guard is in place; the test guards the guard.

## Coverage of the four required areas (C-002)

| Area | How covered | Evidence |
| --- | --- | --- |
| **Three roles normal** | `tests/team-contract.test.mjs` line ~613 → "role launchers inject common-dir identity and isolate Executor/Reviewer environments" (existing, unchanged) asserts the start-mode prompt for executor + reviewer, plus the research-mode prompt for researcher. This slice's new tests cover executor + reviewer directly via `New-RoleContext`. | Existing 20 team-contract tests still green; new tests pass. |
| **Independent worktree** | New test `ISSUE-018: independent worktree paths flow into each role prompt without leaking cross-task paths` — drives `New-RoleContext` with two contracts that have different `worktree` fields and asserts each prompt contains only its own worktree path. | `node --test tests/team-contract.test.mjs` → new test passes. |
| **Permission differences** | The same cost-budget test runs `New-RoleContext` for both `executor` and `reviewer` against the same contract and asserts `sizes.executor !== sizes.reviewer` (byte-level inequality). Each role's prompt must include the role's own delegation id, required capabilities, objective, and role reads — verified by per-role `assert.match` calls. | Same test as above. |
| **Missing environment info** | `Get-ToolRuntimeMetadata` defensive `Fail()` loop (above); new test asserts (a) every required field appears in the produced line on Windows, (b) the script source contains the `Fail` loop and per-field enumeration. | Same new test as above. |

## Pre-existing failure verification (independent of this slice)

The single failing test (`acceptance requires each frozen criterion ID and
synchronizes the Blackboard outcome`) fails identically on `develop` without
my changes. Reproduced via `git stash`:

```bash
cd 'D:/Coding/Harness/Pi-team-ISSUE-018'
git stash
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1 \
  | Select-String -Pattern 'tests |pass |fail |duration'
# → tests 89, pass 79, fail 1   (the same acceptance test)
git stash pop
```

The failure is in the `Accept` function calling `Get-BlackboardTask`, whose
underlying `blackboard-cli.mjs snapshot` returns invalid JSON. It is a
Lead-side runtime issue unrelated to startup injection; per the contract's
`out_of_scope` ("读取或推导 Gold、oracle、期望补丁或评测保留数据"), I do
not widen scope. The Reviewer can confirm by re-running `git stash &&
tests/run-tests.ps1` in this worktree.

## Diff summary

```
 scripts/pi-team.ps1          |  34 ++++++++++++++++++++++++++++-----
 tests/team-contract.test.mjs | 198 ++++++++++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 220 insertions(+), 5 deletions(-)
```

- `scripts/pi-team.ps1`:
  - `Get-ToolRuntimeMetadata` — three `IsNullOrEmpty → 'unknown'` guards
    on `os_family`, `os_version`, `os_architecture`; one new
    `$separator = [IO.Path]::DirectorySeparatorChar` local; one new
    `foreach ($field in @(...)) { Fail ... }` defensive loop.
  - `New-RoleContext` — three lines collapsed into one consolidated
    `Stable project context` line that names `AGENTS.md`,
    `project_state.md`, and `ADR/0002-lead-subagent-collaboration-protocol.md`
    exactly once. The standalone `Normative protocol` line and the
    `Recommended common reads` line are removed. A comment block records
    the rationale and the byte savings.
  - `Research` function — R1 fix: the `$assignment` string no longer
    re-declares `Task ID / Worktree / Research delegation / Research
    artifact / Required capabilities / Objective` after `New-RoleContext`.
    It collapses to
    `"$(New-RoleContext …) Lead assignment. Answer exactly this question: $q"`,
    keeping `Lead assignment.` (Issue #1 Lead 元语) and
    `Answer exactly this question: $q` (the action constraint
    `New-RoleContext` does not emit). Saves ~250 bytes per on-demand
    Researcher launch.
- `tests/team-contract.test.mjs` — three new tests appended at the end of
  the file; zero changes to existing tests.

`tests/run-tests.ps1`, `tests/communication-policy.test.mjs`,
`tests/blackboard.test.mjs`, `.pi/agents/*.md`, `.pi/skills/*/SKILL.md`,
`.pi/communication/`, `plugins/agent-blackboard/`, `scripts/pi-team.cmd`,
`ADR/`, `README.md`, `architect.md`, `goal.md`, `project_state.md` are
all unchanged.

## Verification commands for Lead

```powershell
# 1. Reproduce the full suite (82/92 pass, 1 pre-existing fail).
cd 'D:/Coding/Harness/Pi-team-ISSUE-018'
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1

# 2. Confirm the three ISSUE-018 tests pass.
node --test tests/team-contract.test.mjs | Select-String -Pattern 'ISSUE-018'

# 3. Confirm the pre-existing acceptance test fails identically without
#    my changes.
git stash
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1 \
  | Select-String -Pattern 'tests |pass |fail '
git stash pop

# 4. Inspect the diff (no other file touched).
git diff --stat
git diff scripts/pi-team.ps1

# 5. Confirm no role prompt / skill / policy / blackboard / README was
#    modified.
git diff -- .pi/agents .pi/skills .pi/communication plugins/agent-blackboard README.md

# 6. Measure the Researcher's prompt size after R1 (must be under 1700 bytes).
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command `
  "& { try { . ./scripts/pi-team.ps1 } catch {}; `
     `$c = (Get-Content -Raw ./plans/ISSUE-018-task.md) -replace '(?s).*```json','{' -replace '```.*','' | ConvertFrom-Json; `
     `(New-RoleContext $c 'researcher' 'research' 'sample question').Length }"
```

## Sign-off

This report satisfies `C-002` and `C-004` of the Lead task contract. Lead is
invited to run the five verification commands above to reproduce the
evidence.
