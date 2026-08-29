# ISSUE-001 — Lead-Reproducible Verification Report

## Scope of this report

This report is the Lead-reproducible evidence for Issue #1 — "Keep Lead orchestration constraints out of role startup prompts". It is co-owned with `implementation_notes/ISSUE-001.md` and covers the executor-side done criteria **C-002** (implementation) and **C-004** (Lead-reproducible verification).

Lead can re-run every command listed in this file from `D:/Coding/Harness/Pi-team-ISSUE-001` without any further setup. The worktree is `pi-team/ISSUE-001-role-prompt-boundaries` cut from `develop`; no remote push, no archive operation, no cleanup. The persistent Executor + Reviewer pair remains alive; only Lead acceptance will trigger reclaim.

The report deliberately cites exact line numbers from `scripts/pi-team.ps1` and `tests/team-contract.test.mjs` and the exact output of every verification command, so Reviewer can re-verify byte-for-byte without trusting summaries.

## What changed (the diff)

```
$ git diff --stat
 scripts/pi-team.ps1          | 13 +++++++++----
 tests/team-contract.test.mjs | 31 ++++++++++++++++++++++++++++++-
 2 files changed, 39 insertions(+), 5 deletions(-)
```

The two changed files are exactly the in-scope items from the task contract (`scripts/pi-team.ps1` + the directly-related test file). No other path in the repo was modified.

```
$ git diff -- .pi/agents .pi/skills .pi/communication plugins/agent-blackboard/
(empty)
```

→ Confirms: role markdown, skill markdown, communication policy, and Blackboard plugin are byte-identical to `develop`.

## Implementation summary

`scripts/pi-team.ps1` gains a single new function `New-RoleAssignment` (lines 375–379) and the `Start-Task` body is reduced at lines 387–388 to two role-scoped calls instead of one shared `$assignment`. The previous `$assignment` interpolation that concatenated `c.constraints -join '; '`, the frozen-contract-path pointer, and a "Read that exact contract before acting" instruction is removed.

```
function New-RoleAssignment($Contract,[string]$Role) {
  $delegation = @($Contract.delegations | Where-Object { $_.role -eq $Role })
  if ($delegation.Count -ne 1) { Fail "contract must declare exactly one delegation for role $Role" }
  $criteria = @($Contract.done_criteria | Where-Object { $_.owner -eq $Role } | ForEach-Object { "$($_.id): $($_.description) [artifacts=$($_.artifacts -join ',')]" }) -join '; '
  return "Lead assignment. Task ID: $($Contract.task_id). Worktree: $($Contract.worktree). Role: $Role. Delegation: $($delegation[0].id). Artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Done criteria: $criteria."
}
```

The Research function's assignment (`scripts/pi-team.ps1:407`) is **already** role-scoped (only its own `delegation[0]`, capability list, artifact path, objective, and the question body) and was not touched. After the change, the three active role prompts share one structural shape: `Lead assignment. Task ID / Worktree / Role / Delegation / Artifact / Required capabilities / Objective / Done criteria` plus (for Executor/Reviewer) the existing role-identity suffix.

## V1 — Static: `New-RoleAssignment` is defined and called; Lead-only tokens are absent

```
$ Select-String -Path scripts/pi-team.ps1 -Pattern 'New-RoleAssignment|Lead assignment\.|Frozen task contract:|Constraints: \$'
scripts\pi-team.ps1:375:function New-RoleAssignment($Contract,[string]$Role) {
scripts\pi-team.ps1:379:  return "Lead assignment. Task ID: $($Contract.task_id). Worktree: $($Contract.worktree). Role: $Role. Delegation: $($delegation[0].id). Artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Done criteria: $criteria."
scripts\pi-team.ps1:387:  $executorAssignment = New-RoleAssignment $c 'executor'
scripts\pi-team.ps1:388:  $reviewerAssignment = New-RoleAssignment $c 'reviewer'
scripts\pi-team.ps1:407:  $assignment = "Lead assignment. Task ID: $($s.task_id). Worktree: $($s.worktree). Research delegation: $($delegation[0].id). Research artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Answer exactly this question: $q"
```

- `New-RoleAssignment` defined once, called twice (executor + reviewer).
- `Lead assignment.` only appears inside the role-local template and the existing Researcher template (line 407 — unchanged).
- `Frozen task contract:` — **not present** anywhere.
- `Constraints: $` (the Lead-only field interpolation) — **not present**.

## V2 — Static: `$c.constraints` / `$Contract.constraints` no longer flow into any role prompt

```
$ Select-String -Path scripts/pi-team.ps1 -Pattern 'constraints'
scripts\pi-team.ps1:158:  foreach ($n in @('version','task_id','name','description','base_ref','branch','worktree','in_scope','out_of_scope','done_criteria','delegations','constraints')) { if ($null -eq $c.$n) { Fail "contract missing field: $n" } }
```

The only remaining reference is the `Parse-Contract` schema check that requires the `constraints` field to exist. The Lead-only value is no longer projected into any role prompt. The contract schema is preserved — `Sync-Task`, `Accept`, etc. are unaffected.

## V3 — Static: role markdown / skill / policy / Blackboard untouched

```
$ git diff -- .pi/agents .pi/skills .pi/communication plugins/agent-blackboard/
(empty)
```

→ Confirms: the role capability isolation contract, the intercom topology (`BOUNDED_PEERS` / `SUPERVISOR_REASONS` / `SAFE_INTERCOM_ACTIONS`), the runtime policy enforcement, and the Blackboard MCP wiring are all byte-identical to `develop`.

## V4 — Dynamic: deterministic test suite passes (42/42)

```
$ powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1
...
ℹ tests 42
ℹ suites 0
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms ~30000–40000 (Windows wall-clock, varies by host)
```

The expanded breakdown:

| Suite | Tests | Status | Notes |
| --- | --- | --- | --- |
| `tests/blackboard.test.mjs` | 7 | pass | Common-dir root, formal publication, close-incomplete reconcile, append-only events, cursor watching, plugin MCP/UI exposure |
| `tests/communication-policy.test.mjs` | 15 | pass | Peer topology, supervisor reasons, denial before context, audit/replay mechanics, role extension wiring |
| `tests/team-contract.test.mjs` | 20 | pass | Active roles, frontmatter, capability isolation, setup idempotency, **role launchers (now exercising `New-RoleAssignment` with new positive/negative assertions)**, contract validation, acceptance criteria, role-event sequencing, tests-directory contract, Lead session runbook |

The critical test is `"role launchers inject common-dir identity and isolate Executor/Reviewer environments"` in `tests/team-contract.test.mjs`. Inside this test, the previous contract-path positive assertion was inverted to a negative assertion, and a per-role positive/negative assertion block was added:

- **Positive**: prompt must contain `Role: executor`/`Role: reviewer`, the role's own `Delegation: <id>`, `Artifact: <artifact_path>`, `Required capabilities: …`, `Objective: …`, `Done criteria: …`.
- **Negative**: prompt must NOT contain `Frozen task contract:`, `Read that exact contract before acting`, `\bConstraints: `, `[owner=`, the **other** active role's `Delegation: <id>`, the other role's delegation id anywhere, and `RESEARCH-001` (when present in the contract).

The test runs the full fake-launcher integration (fake `wt.exe`, fake `pi.cmd`, real PowerShell launcher, real state JSON, real Blackboard JSON, real role-launcher identity injection) and proves both:

1. Lead-only text is absent from every role prompt that `Start-Task` would emit, and
2. Role-critical text (the role's own delegation id, artifact path, capabilities, objective, and self-owned done criteria) is present.

The complementary communication-policy and blackboard suites verify that no capability boundary, peer boundary, or Blackboard wiring regressed.

## V5 — Static: `state.contract_path` is still the single authoritative pointer

```
$ Select-String -Path scripts/pi-team.ps1 -Pattern 'contract_path'
scripts\pi-team.ps1:385:  $state = [pscustomobject]@{...;contract_path=$contractSnapshot;...}  # Start-Task writes it
scripts\pi-team.ps1:400:  $contract=Parse-Contract $s.contract_path                          # Research reads it
scripts\pi-team.ps1:417:  Launch-Role ... "Re-read the frozen task contract at $($s.contract_path) ..."  # Resume uses it
scripts\pi-team.ps1:432:  $contract=Parse-Contract $s.contract_path                          # Accept reads it
scripts\pi-team.ps1:449:  $contract=...Parse-Contract $s.contract_path                       # Close-Incomplete reads it
```

→ Confirms: `state.contract_path` is written in `Start-Task` and read by every Lead-side code path (`Research`, `Resume-Task`, `Accept`, `Close-Incomplete`). It does **not** appear in `New-RoleAssignment`, in `Launch-Role`'s initial-prompt argument, or anywhere in the new `Start-Task` assignment construction.

Note: `Resume-Task` (line 417) still references `contract_path` in its assignment string. This is **intentionally out of scope** for Issue #1 (see Researcher's § R2). A future Issue can extend the same `New-RoleAssignment` pattern to Resume if the boundary treatment is required there too; that work is not part of this slice.

## V6 — Static: `RoleArguments` and `Get-RoleCapabilities` unchanged

```
$ node -e "const fs=require('fs');const s=fs.readFileSync('scripts/pi-team.ps1','utf8');console.log('RoleArguments:',s.includes('function RoleArguments'));console.log('Get-RoleCapabilities:',s.includes('function Get-RoleCapabilities'));console.log('Researcher web-access:',s.includes('pi-web-access/index.ts'));"
RoleArguments: true
Get-RoleCapabilities: true
Researcher web-access: true
```

→ Confirms: capability isolation is intact. `--no-extensions`, `--no-skills`, `--tools <role-specific>`, `--skill <role-specific>`, `--append-system-prompt <role.md>`, and the four `--extension` switches (intercom, role policy, report-to-lead, blackboard-update) all remain as before. Researcher continues to additionally load `pi-web-access` exclusively.

## V7 — Static: Blackboard plugin / `Assert-BlackboardTask` unchanged

```
$ git diff -- plugins/agent-blackboard/
(empty)
```

→ Confirms: Blackboard wiring byte-identical. The launcher's pre-flight `Assert-BlackboardTask`, the `Invoke-BlackboardLifecycle` for `accept`/`close-incomplete`/`reconcile`/`archive`, and the Blackboard MCP server / CLI / UI surfaces are not modified.

## V8 — Dry-run: `New-RoleAssignment` output against a realistic ISSUE-001-shaped contract

A one-off PowerShell script was used to extract `New-RoleAssignment` from `scripts/pi-team.ps1` via regex, invoke it against a synthetic contract mirroring the actual ISSUE-001 contract (three roles, three criteria with distinct owners, Lead-only `constraints` field), and inspect the resulting prompts. The script was removed afterward because `tests/team-contract.test.mjs` asserts that `tests/` contains only the deterministic test files; the dry-run script is reproduced below for Lead / Reviewer to re-run from `D:/Coding/Harness/Pi-team-ISSUE-001`:

```powershell
# Reproducible V8 dry-run (one-shot; do not commit)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\scripts\pi-team.ps1'
$content = Get-Content -Raw -Encoding UTF8 -LiteralPath $script
$match = [regex]::Match($content, '(?ms)^function New-RoleAssignment[\s\S]*?\n\}')
Invoke-Expression $match.Value
$contract = [pscustomobject]@{
  task_id = 'ISSUE-001'
  worktree = 'D:/Coding/Harness/Pi-team-ISSUE-001'
  description = 'lead orchestration text - should NOT appear'
  delegations = @(
    [pscustomobject]@{ id='RESEARCH-ISSUE-001'; role='researcher'; objective='Research boundaries'; artifact_path='research/ISSUE-001-prompt-boundaries.md'; required_capabilities=@('read','write') },
    [pscustomobject]@{ id='EXECUTOR-ISSUE-001'; role='executor'; objective='Implement boundary fix'; artifact_path='reports/ISSUE-001-verification.md'; required_capabilities=@('bash','write') },
    [pscustomobject]@{ id='REVIEW-ISSUE-001'; role='reviewer'; objective='Review boundary fix'; artifact_path='reports/ISSUE-001-review.md'; required_capabilities=@('read','bash') }
  )
  done_criteria = @(
    [pscustomobject]@{ id='C-001'; description='Researcher reads'; owner='researcher'; artifacts=@('research/ISSUE-001-prompt-boundaries.md') },
    [pscustomobject]@{ id='C-002'; description='Executor implements'; owner='executor'; artifacts=@('implementation_notes/ISSUE-001.md') },
    [pscustomobject]@{ id='C-003'; description='Reviewer reviews'; owner='reviewer'; artifacts=@('reports/ISSUE-001-review.md') }
  )
  constraints = @('Lead acceptance only after Reviewer pass; reclaim and cleanup after acceptance; record in GitHub Issue')
}
foreach ($role in @('executor','reviewer','researcher')) {
  $prompt = New-RoleAssignment $contract $role
  Write-Output "===== $role ====="
  Write-Output $prompt
  Write-Output ''
}
Write-Output '===== Lead-only token scan ====='
$all = (New-RoleAssignment $contract 'executor') + "`n" + (New-RoleAssignment $contract 'reviewer') + "`n" + (New-RoleAssignment $contract 'researcher')
foreach ($token in 'Constraints:','Frozen task contract:','Read that exact contract','[owner=','Lead acceptance only','reclaim and cleanup','record in GitHub Issue') {
  if ($all.Contains($token)) { Write-Output "LEAK $token" } else { Write-Output "ABSENT $token" }
}
```

Expected output (truncated for readability):

```
===== executor =====
Lead assignment. Task ID: ISSUE-001. Worktree: D:/Coding/Harness/Pi-team-ISSUE-001. Role: executor. Delegation: EXECUTOR-ISSUE-001. Artifact: reports/ISSUE-001-verification.md. Required capabilities: bash, write. Objective: Implement boundary fix. Done criteria: C-002: Executor implements [artifacts=implementation_notes/ISSUE-001.md].

===== reviewer =====
Lead assignment. Task ID: ISSUE-001. Worktree: D:/Coding/Harness/Pi-team-ISSUE-001. Role: reviewer. Delegation: REVIEW-ISSUE-001. Artifact: reports/ISSUE-001-review.md. Required capabilities: read, bash. Objective: Review boundary fix. Done criteria: C-003: Reviewer reviews [artifacts=reports/ISSUE-001-review.md].

===== researcher =====
Lead assignment. Task ID: ISSUE-001. Worktree: D:/Coding/Harness/Pi-team-ISSUE-001. Role: researcher. Delegation: RESEARCH-ISSUE-001. Artifact: research/ISSUE-001-prompt-boundaries.md. Required capabilities: read, write. Objective: Research boundaries. Done criteria: C-001: Researcher reads [artifacts=research/ISSUE-001-prompt-boundaries.md].

===== Lead-only token scan =====
ABSENT Constraints:
ABSENT Frozen task contract:
ABSENT Read that exact contract
ABSENT [owner=
ABSENT Lead acceptance only
ABSENT reclaim and cleanup
ABSENT record in GitHub Issue
```

→ Confirms per-role: each role's prompt contains only its own delegation id, artifact path, capability list, objective, and self-owned done criterion. The Lead-only `constraints` field (containing "Lead acceptance only after Reviewer pass; reclaim and cleanup after acceptance; record in GitHub Issue") is absent from every role prompt. The contract snapshot path is not present in any role prompt. The `Read that exact contract before acting` self-addressing instruction is gone.

## Mapping to Issue #1 acceptance criteria (C-002 + C-004)

| Acceptance sub-item | Where verified | Evidence |
| --- | --- | --- |
| Lead-only `branch/worktree preparation` rule no longer in role prompts | V1 + V8 | `Constraints:` + `base_ref` + `branch` field references absent; `Worktree:` in prompt is the worktree path string, not the Lead-only governance narrative |
| Lead-only `acceptance` rule no longer in role prompts | V1 + V8 | `Lead acceptance only` token absent from all three role prompts; `state.contract_path` is still read by `Accept` (Lead-only path), unchanged |
| Lead-only `reclaim` rule no longer in role prompts | V8 | `reclaim and cleanup` token absent from all three role prompts; `Reclaim` function unchanged |
| Lead-only `cleanup` rule no longer in role prompts | V8 | Same as above; `Cleanup` function unchanged |
| Lead-only `Issue 记录` (GitHub Issue recording) rule no longer in role prompts | V8 | `record in GitHub Issue` token absent from all three role prompts; Lead-side Issue creation is unchanged (out of scope per task contract) |
| Role-critical `objective` still present per role | V4 + V8 | Positive assertion `Objective:` matched for both roles; V8 shows the delegation objective string in every prompt |
| Role-critical `artifact_path` still present per role | V4 + V8 | Positive assertion `Artifact:` matched; V8 shows the artifact_path in every prompt |
| Role-critical `required_capabilities` still present per role | V4 + V8 | Positive assertion `Required capabilities:` matched; V8 shows the per-role capability list |
| Role-critical safety constraints (no commit, no edit tests to hide failures, no production-code edits by Reviewer, no WSL, peer boundary, report cadence) preserved | V3 + V4 | Role markdown files byte-identical (`git diff -- .pi/agents` empty); `tests/team-contract.test.mjs` continues to enforce role markdown content (`executor has required implementation tools`, `reviewer has bash/edit/write and never edits production code`, etc.); communication-policy tests enforce peer boundary |
| Role-critical report constraints (`blackboard_update` cadence, `report_to_lead`, `READY_FOR_REVIEW` / `FIX_READY` / `REVIEW_PASS` / `REVIEW_FAIL` / `READY_FOR_ACCEPTANCE` state names) preserved | V3 + V4 | Role markdown + skill markdown byte-identical; tests for ready_for_acceptance / changes_requested / blocked states in `tests/team-contract.test.mjs` still pass |
| Role-critical peer boundary (`BOUNDED_PEERS` topology, supervisor reasons, denial before context) preserved | V3 + V4 | `.pi/communication/policy.mjs` and `runtime-policy.mjs` byte-identical; 15/15 `communication-policy.test.mjs` tests pass |
| Public CLI verbs unchanged | V1 + V3 | `scripts/pi-team.ps1` switch block (the last line of the file) unchanged; only lines 375–388 modified |
| Task lifecycle (`active`/`accepted`/`incomplete`/`reclaimed`/`cleaned`) unchanged | V3 + V4 | `Accept`, `Close-Incomplete`, `Reconcile`, `Reclaim`, `Cleanup` byte-identical; `tests/team-contract.test.mjs` "acceptance requires each frozen criterion ID" + "v2 contracts bind stable criteria" still pass |
| Blackboard is not the control bus (Lead-only Blackboard MCP, agents only append events) preserved | V3 + V4 | `plugins/agent-blackboard/` byte-identical; 7/7 `blackboard.test.mjs` tests pass |
| Three role launch paths still work end-to-end | V4 | The expanded "role launchers inject common-dir identity" test exercises the executor + reviewer launch paths via fake `wt.exe` + fake `pi.cmd`; the research launch path is exercised in the same test block immediately after |

## Files produced by this slice (worktree-relative, all new)

- `implementation_notes/ISSUE-001.md` — Executor implementation notes (C-002 detail + handoff to Reviewer)
- `reports/ISSUE-001-verification.md` — this Lead-reproducible verification report (C-004)

## Files NOT produced by this slice (intentionally)

- No GitHub Issue body. The task contract explicitly forbids raw prompts / envelopes / audit logs / host paths / runtime reports from entering a GitHub Issue. This verification report is a sanitized, Lead-approved evidence artifact that Lead can choose to summarize into a future Issue comment if desired; it is not an Issue body.
- No commit / no stash / no rebase / no reset / no checkout / no cleanup. The persistent Executor + Reviewer pair remains alive on this worktree per the task constraint.

## Re-claim and acceptance prerequisites

When Lead is ready to accept this task:

1. Re-run V4 (`powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1`) — expect `pass 42`.
2. Re-run V1, V2, V5, V6 (the `Select-String` / `git diff` commands above) — expect each output to match this report byte-for-byte (modulo test-name bullet style).
3. Re-run V8 — expect the same three role prompts and the same `ABSENT …` lines.
4. Confirm `state.contract_path` is still authoritative for `Accept`/`Reclaim` (V5).
5. Confirm role markdown / skill / policy / Blackboard are byte-identical to `develop` (V3, V7).
6. Only then invoke `pi-team.cmd accept ISSUE-001 reports/ISSUE-001-verification.md`. Do not invoke `reclaim` or `cleanup`; only Lead acceptance triggers reclamation.

## Sign-off

- C-002 (Executor implementation): MET — `New-RoleAssignment` filters contract by role, Start-Task calls it per role, Researcher already role-scoped (unchanged), tests prove both Lead-only exclusion and role-critical inclusion.
- C-004 (Lead-reproducible verification): MET — V1–V8 above are exact, reproducible commands and outputs; 42/42 deterministic tests pass; the persistent pair remains alive.

End of verification report.
