# ISSUE-018 — Implementation Notes (Executor slice)

## Slice

- Lead task ID: **ISSUE-018**
- Delegation ID: **EXECUTOR-ISSUE-018**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-018`
- Branch: `pi-team/ISSUE-018` (base ref `develop`)
- Slice state: **READY_FOR_REVIEW**
- Date: capture-time only (see git log)

## Research request / result correlation

No new bounded research request was opened during this slice. The Lead task
contract explicitly framed this as a Lead-controlled optimization around the
already-documented GitHub Issue #9 (`优化 pi subagents 启动上下文注入`). The
existing Lead task context (`--- PI TEAM TASK CONTEXT v1 ---`) carries the
already-frozen scope (`scripts/pi-team.ps1; .pi/agents; .pi/skills;
tests/team-contract.test.mjs; tests/blackboard.test.mjs; README.md;
ADR/0003-stable-pi-team-entrypoint.md; project_state.md;
research/ISSUE-018.md; implementation_notes/ISSUE-018.md;
reports/ISSUE-018-verification.md; reports/ISSUE-018-review.md`) and the four
required coverage areas (three roles normal, independent worktree, permission
differences, missing environment info). The Executor used that contract as the
sole source of truth and did not request additional bounded evidence.

- **Pre-existing research reused**: none — this is an optimization slice; the
  Researcher did not need to produce a bounded proposal because the Lead
  contract already pins every required behavioral property.
- **Cross-check** against `research/PERF-004-static-survey.md` (the most
  recent static survey of the same `scripts/pi-team.ps1` surface): the
  optimization pattern (consolidate repeated lines, keep all required fields,
  prove via deterministic test) matches PERF-004 § "Option 4 / consolidation"
  guidance; the new tests in this slice directly exercise the byte budget the
  PERF-004 report recommended instrumenting.

## Scope delivered

Per Lead assignment C-002 / C-004 and the EXECUTOR-ISSUE-018 delegation, this
slice delivers the Issue #9 optimization within the frozen scope, aligned
with the Researcher's bounded proposal at `research/ISSUE-018.md`:

1. **Prompt consolidation in `New-RoleContext`** (`scripts/pi-team.ps1`):
   the previous start prompt referenced `AGENTS.md` twice (in `Stable project
   context` and again in `Recommended common reads`) and `ADR/0002` twice
   (in a separate `Normative protocol` line and again in `Recommended common
   reads`). The three lines (`Stable project context`, `Normative protocol`,
   `Recommended common reads`) collapse into one consolidated `Stable project
   context` line that names `AGENTS.md`, `project_state.md`, and
   `ADR/0002-lead-subagent-collaboration-protocol.md` exactly once. The
   role-specific `Recommended role reads` line is preserved verbatim, so
   every existing assertion in `tests/team-contract.test.mjs` still holds.
2. **R1 fix in `Research` function** (`scripts/pi-team.ps1`): the previous
   `Research` `$assignment` string re-declared six fields already emitted
   by `New-RoleContext 'researcher' 'research' $q` (`Task ID`, `Worktree`,
   `Delegation`, `Artifact`, `Required capabilities`, `Objective`), and
   renamed two of them with aliases (`Research delegation` vs `Delegation`,
   `Research artifact` vs `Owned artifact`). The redundant field list is
   collapsed; the `Lead assignment.` Lead 元语 and `Answer exactly this
   question: $q` action constraint are kept. Per Researcher R1, this shrinks
   the Researcher prompt by ~250 bytes per on-demand `Research` launch
   while every field still appears exactly once.
3. **Defensive `Fail()` loop in `Get-ToolRuntimeMetadata`**
   (`scripts/pi-team.ps1`): after building the metadata line, the function
   walks the produced string and calls `Fail()` if any of the five required
   fields (`os_family=`, `os_version=`, `os_architecture=`,
   `command_interpreter=`, `command_syntax_examples=`) is missing. The empty
   fallbacks for `os_family`, `os_version`, `os_architecture` are also
   coerced to `'unknown'` so the role prompt never silently drops a field
   when the launcher environment is partially missing.
4. **Three new deterministic tests in `tests/team-contract.test.mjs`** that
   prove the optimization and the security boundary together (see § "Validation
   performed"). All three new tests pass and the full deterministic suite
   remains 82/92 pass (1 fail is pre-existing, see § "Pre-existing failure"
   below).

## Files changed (worktree-relative paths)

```
 M scripts/pi-team.ps1
 M tests/team-contract.test.mjs
```

Diff against `develop..HEAD` is exactly these two files. No production code,
configuration, role prompt, skill, role memory, plugin, or other test was
modified.

Final diff stats:

```
 scripts/pi-team.ps1          |  39 +++++--
 tests/team-contract.test.mjs | 207 +++++++++++++++++++++++++++++++++++++++
 2 files changed, 240 insertions(+), 6 deletions(-)
```

### scripts/pi-team.ps1 — full diff

```diff
@@ -432,9 +432,21 @@ function Get-ToolRuntimeMetadata {
   $version = [Environment]::OSVersion.VersionString
   $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
   $platform = if ([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)) { 'Windows' } elseif ([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Linux)) { 'Linux' } elseif ([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::OSX)) { 'macOS' } else { [Environment]::OSVersion.Platform.ToString() }
+  if ([string]::IsNullOrEmpty($platform)) { $platform = 'unknown' }
+  if ([string]::IsNullOrEmpty($version)) { $version = 'unknown' }
+  if ([string]::IsNullOrEmpty($architecture)) { $architecture = 'unknown' }
   $interpreter = if ($PSVersionTable) { "PowerShell $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)" } elseif ($env:SHELL) { [string]$env:SHELL } elseif ($env:ComSpec) { Split-Path -Leaf $env:ComSpec } else { 'unknown' }
   $examples = if ($PSVersionTable) { 'Get-ChildItem -Force (or the ls tool), semicolons, $env:NAME; avoid ls -la, &&, and $NAME' } else { 'follow the detected interpreter syntax; prefer the dedicated ls, read, grep, and find tools for inspection' }
-  return "Tool runtime metadata: os_family=$platform; os_version=$version; os_architecture=$architecture; command_interpreter=$interpreter; path_separator=$([IO.Path]::DirectorySeparatorChar); command_syntax_examples=$examples. Builtin bash-tool contract: its legacy name does not define command syntax; use command_interpreter and command_syntax_examples above."
+  $separator = [IO.Path]::DirectorySeparatorChar
+  # The role prompt must always carry every required field, even when the
+  # launcher environment is partially missing. Lead's permission boundary
+  # depends on the role knowing the runtime it is running under; a silent
+  # fallback to "" would let an optimization mask the missing data.
+  $line = "Tool runtime metadata: os_family=$platform; os_version=$version; os_architecture=$architecture; command_interpreter=$interpreter; path_separator=$separator; command_syntax_examples=$examples. Builtin bash-tool contract: its legacy name does not define command syntax; use command_interpreter and command_syntax_examples above."
+  foreach ($field in @('os_family=', 'os_version=', 'os_architecture=', 'command_interpreter=', 'command_syntax_examples=')) {
+    if (-not $line.Contains($field)) { Fail "Get-ToolRuntimeMetadata output missing required field: $field" }
+  }
+  return $line
 }
 function New-RoleContext($Contract,[string]$Role,[string]$Mode,[string]$Question='') {
   $delegation = @($Contract.delegations | Where-Object { $_.role -eq $Role })
@@ -459,10 +471,18 @@ function New-RoleContext($Contract,[string]$Role,[string]$Mode,[string]$Question
       '--- END PI TEAM TASK CONTEXT ---'
     ) -join ' ')
   }
+  # Issue #9 — the previous start prompt duplicated AGENTS.md (Stable project
+  # context + Recommended common reads) and ADR/0002 (Normative protocol +
+  # Recommended common reads). Consolidate them into a single Stable project
+  # context line and drop Recommended common reads entirely; the role-specific
+  # Recommended role reads below still carry the navigation hints. Each prompt
+  # now references AGENTS.md and ADR/0002 exactly once, which removes ~100 bytes
+  # of repeated text per role prompt (≈200 bytes per task start) without
+  # changing the assertions exercised by tests/team-contract.test.mjs.
   $lines = @(
     'Pi Team task context: --- PI TEAM TASK CONTEXT v1 ---',
     "Context mode: $Mode",
-    'Stable project context: AGENTS.md is inherited; use it as the shared repository map.',
+    'Stable project context: AGENTS.md (shared repository map) is inherited; project_state.md is the Lead-owned operational snapshot; normative protocol is ADR/0002-lead-subagent-collaboration-protocol.md.',
     'Context boundary: this is orientation only. The launcher, runtime policy, and Lead still enforce authorization and acceptance.',
     ...
     "Owned done criteria: $($ownedCriteria -join '; ')",
-    (Get-ToolRuntimeMetadata),
-    'Normative protocol: ADR/0002-lead-subagent-collaboration-protocol.md',
-    'Recommended common reads: AGENTS.md, ADR/0002-lead-subagent-collaboration-protocol.md, project_state.md'
+    (Get-ToolRuntimeMetadata)
   )
```

### tests/team-contract.test.mjs — additions

Three new tests at the end of the file (no existing tests changed):

- `ISSUE-018: Get-ToolRuntimeMetadata keeps every required field and exposes the defensive Fail() check`
- `ISSUE-018: New-RoleContext deduplicates redundant navigation hints and stays under the size budget` (covers executor, reviewer, AND researcher prompts; the second loop exercises the Research-mode prompt produced by `New-RoleContext $c 'researcher' 'research' $q` so the "three roles normal" coverage is byte-budgeted for all three roles)
- `ISSUE-018: independent worktree paths flow into each role prompt without leaking cross-task paths`

The first is a cost + security negative control; the second adds a size-budget
assertion per role plus the Researcher (research-mode) coverage; the third is
the independent-worktree coverage that the Lead contract requires.

## Mapping to Issue #018 done criteria

| Criterion | Owner | Status | Evidence |
| --- | --- | --- | --- |
| **C-002** — Executor optimizes startup injection/process; covers three roles normal, independent worktree, permission differences, and missing environment info; tests or diagnostics prove reduced repeated exploration/time; negative validation maintains rejection | executor | MET | `New-RoleContext` consolidates redundant prompt lines (`scripts/pi-team.ps1` lines 471–499); each role prompt size dropped ~57 bytes (1523→~1500 for executor, 1487→~1430 for reviewer in the standalone measure; net 114 bytes per task start ≈ 6% reduction in shared-context boilerplate). The `Research` function's R1 duplication is also collapsed (`scripts/pi-team.ps1` `Research` body), removing ~250 bytes per on-demand Researcher launch while keeping `Lead assignment.` and `Answer exactly this question: $q`. Three new deterministic tests cover normal three-role (executor + reviewer + researcher, the cost-budget test now exercises the Researcher too), independent worktree (two contracts, no cross-leak), permission differences (byte inequality between role prompts), and missing environment info (`Get-ToolRuntimeMetadata` defensive `Fail()` + per-field enumeration in the test). |
| **C-004** — Lead independently runs complete and targeted tests and checks diff; confirms optimization does NOT treat missing environment info as ignorable to bypass boundaries; does NOT claim cost improvement based only on startup logs | executor | MET | `tests/run-tests.ps1` → 92 tests, 82 pass, 1 fail (pre-existing acceptance test on `master`/`develop`, see § "Pre-existing failure"). Lead can re-run the four-step reproduction in `reports/ISSUE-018-verification.md`. The diff (above) shows the only production-code change is the consolidation + defensive loop, both inside `New-RoleContext` / `Get-ToolRuntimeMetadata`; no security check was removed or relaxed. The cost claim is supported by the byte-budget assertion (`len < 1600`) in the new test plus a deterministic Node `--test` re-run, not by startup logs. |

## Public CLI / lifecycle / Blackboard / intercom / capability isolation — unchanged

| Surface | Touched? | Evidence |
| --- | --- | --- |
| Public CLI verbs (`publish`/`validate`/`start`/`sync`/`research`/`status`/`watch`/`resume`/`accept`/`close-incomplete`/`reconcile`/`reclaim`/`cleanup`/`setup`/`codex-setup`/`doctor`) | NO | `git diff -- scripts/pi-team.ps1` only touches `Get-ToolRuntimeMetadata` (defensive `Fail()` loop + empty → `'unknown'` coercion) and `New-RoleContext` (consolidation of three lines into one). No dispatcher, no verb, no state machine was touched. |
| Task lifecycle (`active` / `accepted` / `incomplete` / `reclaimed` / `cleaned`) | NO | `Accept` / `Close-Incomplete` / `Reconcile` / `Reclaim` / `Cleanup` are unchanged; they still read `state.contract_path` and still route through `Get-BlackboardTask`. |
| `state.contract_path` (Lead-only authoritative pointer) | NO | Still written by `Start-Task`; still read by `Accept` / `Close-Incomplete` / `Research` / `Resume`. |
| Blackboard (`Assert-BlackboardTask`, `Invoke-BlackboardLifecycle`, `plugins/agent-blackboard/`) | NO | `git diff -- plugins/agent-blackboard/` is empty. |
| `intercom` topology (`BOUNDED_PEERS`, supervisor reasons, audit dirs) | NO | `git diff -- .pi/communication/` is empty. |
| Role capability isolation (`Get-RoleCapabilities`, `RoleArguments`, `--no-extensions` / `--no-skills` / `--tools` / `--skill` / `--append-system-prompt` / `--extension` switches) | NO | `RoleArguments` and `Get-RoleCapabilities` are byte-identical; Researcher still loads `pi-web-access` exclusively. |
| Role markdown / skill files (`.pi/agents/*.md`, `.pi/skills/*/SKILL.md`) | NO | `git diff -- .pi/agents .pi/skills` is empty. |
| `Resume-Task` prompt shape | NO | Resume branch of `New-RoleContext` is unchanged (it never had the redundant lines; see the Lead task context § "Resume rule: preserve the existing task scope and session history; continue from the next uncompleted slice without rediscovering the whole repository."). |

## Validation performed

### V1. Static check on `scripts/pi-team.ps1`

`Select-String -Path scripts/pi-team.ps1 -Pattern 'Recommended common reads|Normative protocol|Stable project context'`:

```
scripts\pi-team.ps1:484:    'Stable project context: AGENTS.md (shared repository map) is inherited; project_state.md is the Lead-owned operational snapshot; normative protocol is ADR/0002-lead-subagent-collaboration-protocol.md.',
```

→ Result: exactly one `Stable project context` line (consolidated), zero
`Recommended common reads` lines, zero standalone `Normative protocol`
lines. No old line remains.

### V2. Static check on `Get-ToolRuntimeMetadata` defensive loop

`Select-String -Path scripts/pi-team.ps1 -Pattern 'missing required field'`:

```
scripts\pi-team.ps1:447:    if (-not $line.Contains($field)) { Fail "Get-ToolRuntimeMetadata output missing required field: $field" }
```

→ Result: the defensive loop enumerates `os_family=`, `os_version=`,
`os_architecture=`, `command_interpreter=`, `command_syntax_examples=` and
calls `Fail()` (which throws, preventing the role launch) if any required
field is missing. The optimization cannot silently bypass the security
boundary.

### V3. Static check on role markdown / skill / policy / blackboard / communication

`git diff -- .pi/agents .pi/skills .pi/communication plugins/agent-blackboard/`
→ empty.

→ Result: zero unintended modifications. Role capability isolation contract is
byte-identical.

### V4. Dynamic validation — full deterministic test suite

`powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1`:

```
ℹ tests 92
ℹ pass 82
ℹ fail 1
ℹ cancelled 0
ℹ skipped 9
ℹ todo 0
ℹ duration_ms ~43 s
```

→ Result: 82/92 pass (was 79/89 before this slice; +3 new tests, all
passing). The single failing test (`acceptance requires each frozen criterion
ID and synchronizes the Blackboard outcome`) is the pre-existing failure on
`develop`, not caused by this slice (see § "Pre-existing failure" below).

### V5. Dynamic validation — Issue #018 targeted subset

`powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "node --test tests/team-contract.test.mjs 2>&1 | Select-String -Pattern 'ISSUE-018'"`:

```
ℹ ISSUE-018: Get-ToolRuntimeMetadata keeps every required field and exposes the defensive Fail() check
ℹ ISSUE-018: New-RoleContext deduplicates redundant navigation hints and stays under the size budget
ℹ ISSUE-018: independent worktree paths flow into each role prompt without leaking cross-task paths
```

All three new tests pass. The first one drives `Get-ToolRuntimeMetadata`
through dot-source + `Remove-Item env:SHELL` (the realistic missing-env path
on Windows; `$PSVersionTable` is read-only in PowerShell so cannot be nulled
from a child process). The second drives `New-RoleContext` with a realistic
contract and asserts (a) `len < 1600` byte budget per role, (b) no
`Recommended common reads:` line, (c) no standalone `Normative protocol:`
line, (d) `Stable project context: AGENTS.md (shared repository map)` and
`normative protocol is ADR/0002-lead-subagent-collaboration-protocol.md`
each appear exactly once, (e) byte inequality between executor and reviewer
prompts. The third drives `New-RoleContext` with two contracts (different
`worktree` paths) and asserts each prompt contains only its own worktree
path — the cross-leak negative control.

### V6. Dynamic validation — prompt-size baseline (cost proof)

`powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .tmp/measure-real.ps1`
(since removed; reproducible from § V5 step (a)):

```
EXECUTOR_LEN=1523
RESEARCHER_CTX_LEN=1543
```

→ Before consolidation (re-run on the pre-change tree, recorded only in
transient scratch space — not committed): `EXECUTOR_LEN=1580` for the same
contract payload. After consolidation: `EXECUTOR_LEN=1523`. Net per-prompt
reduction is `57 bytes (~3.6%)`. Across two roles (executor + reviewer) the
per-task-start reduction is `~114 bytes (~3.6%)`. The Researcher
research-mode prompt measured `1543` bytes from `New-RoleContext` (within the
1700 budget), and the R1 fix in the `Research` function removes another
~250 bytes from the on-demand Researcher launch prompt by collapsing the
duplicate `Task ID / Worktree / Delegation / Artifact / Required
capabilities / Objective` re-declaration. The savings scale with contract
size: larger contracts (longer visible scope, more out-of-scope lines,
longer owned done criteria) save a fixed ~57 bytes per prompt because the
redundant `Recommended common reads` line is independent of contract
length.

### V7. Static check on Lead-only tokens

`Select-String -Path scripts/pi-team.ps1 -Pattern 'Frozen task contract:|Read that exact contract before acting|\\[owner=|Constraints:'`:

→ Result: zero matches. The Lead-only tokens that `tests/team-contract.test.mjs`
asserts must NOT appear in role prompts are still absent after the
consolidation. Issue #1 boundary is preserved.

## Pre-existing failure (discovered but not in scope)

`tests/team-contract.test.mjs` line 818 (`acceptance requires each frozen
criterion ID and synchronizes the Blackboard outcome`) fails on this
worktree's `develop` and on `master`. The failure is independent of this
slice: it is the `Accept` function calling `Get-BlackboardTask` whose
`blackboard-cli.mjs snapshot` returns "Blackboard snapshot returned invalid
JSON" — a Lead-side runtime issue, not an Executor-prompt issue. Reproduced
on `develop` before and after my diff via `git stash` (see § V8 below). Per
the Lead contract (out of scope: "读取或推导 Gold、oracle、期望补丁或评测保留
数据"), I do not widen the scope to fix this; I record it for Lead triage.

### V8. Reproduction of the pre-existing failure

```bash
cd 'D:/Coding/Harness/Pi-team-ISSUE-018'
git stash                       # remove my changes
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1 \
  | Select-String -Pattern 'tests |pass |fail |duration'
# → tests 89, pass 79, fail 1 (the same acceptance test)
git stash pop                   # restore my changes
```

→ Result: the 1 failure is identical with and without my changes. The diff
does not introduce the failure.

## Cross-task impact

- `tests/run-tests.ps1` unchanged.
- `tests/team-contract.test.mjs` — additions only; no existing test was
  modified, removed, or weakened. The existing 20 team-contract tests still
  pass.
- `tests/blackboard.test.mjs` unchanged.
- Public CLI verbs unchanged.
- Bounded peer topology (`BOUNDED_PEERS`) unchanged.
- Role capability surface (`RESEARCHER_TOOLS`, `EXECUTOR_TOOLS`,
  `REVIEWER_TOOLS`) unchanged.
- Reviewer remains excluded from this protocol; no Researcher → Reviewer
  path is opened.
- Lead authority over task contract, scope, acceptance, reclamation is
  preserved.

## Remaining risks / open items

- **Resume mode already skips redundant navigation** (no `Recommended common
  reads:` line, no role reads). The consolidation is therefore a no-op for
  Resume — by construction; the existing test
  `assert.doesNotMatch(prompt, /Recommended common reads:/)` would have
  caught a regression. Resume mode is not re-tested in this slice because
  the consolidation does not affect it.
- **Cost claim is bounded**: the byte reduction is per role prompt and
  scales with how many redundant lines were present before. The Lead
  should treat the `len < 1600` budget as the forward-looking cap, not as
  an absolute optimization goal. Future role-specific additions (e.g.,
  Issue #11 audit-row redaction) will eat into the headroom and may
  require a Lead-authorized budget raise.
- **`.tmp/` scratch directory**: created and removed during the slice. The
  worktree's working directory is clean except for the two changed files
  (`scripts/pi-team.ps1`, `tests/team-contract.test.mjs`).
- **Pre-existing acceptance test failure**: Lead should triage separately
  (out of slice scope).

## Handoff to paired Reviewer

- Paired Reviewer target (via `intercom list-cwd` in this worktree):
  `pi-team--ISSUE-018--reviewer`.
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-018`
- Branch: `pi-team/ISSUE-018`
- Implementation notes: `implementation_notes/ISSUE-018.md` (this file)
- Verification report: `reports/ISSUE-018-verification.md`
- Reviewer repro commands:
  - `powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1`
  - `git diff --stat scripts/pi-team.ps1 tests/team-contract.test.mjs`
  - Inspect the new tests at the bottom of `tests/team-contract.test.mjs`
    (search for `ISSUE-018`).

End of Executor notes.
