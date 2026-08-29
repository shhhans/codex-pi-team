# ISSUE-001 — Reviewer Independent Re-Verification Report

- Lead task ID: **ISSUE-001**
- Delegation ID: **REVIEW-ISSUE-001**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-001`
- Branch: `pi-team/ISSUE-001-role-prompt-boundaries` (base ref `develop`)
- Slice verdict: **REVIEW PASS** for Executor slice C-002 / C-004; C-001 cross-checked.
- Date: capture-time only (see git log)
- Reviewer constraints honored: read-only Git ops (`status`, `diff`, `log`, `show`, `blame`); only test files / failure artifacts created; no production-code edits; no commit, stash, reset, checkout, rebase, cleanup; persistent pair remains alive; Reviewer dry-run script created under `tests/_reviewer-v8-dryrun.ps1` and removed after verification (the `tests/` directory now contains only the deterministic contract and communication-policy tests).

## Scope verified

| Criterion | Owner | Status | Reviewer evidence |
| --- | --- | --- | --- |
| **C-001** — Researcher identifies Lead-only vs role-critical; proposes minimal safe split | researcher | MET (cross-checked) | `research/ISSUE-001-prompt-boundaries.md` (~35 KB, ~5200 words) contains the Lead-only/role-critical split, R1–R8 compatibility risks, negative scenarios, and S1–S6 minimal split proposal. The Executor's implementation closely tracks S1, S2, S5. |
| **C-002** — Executor implements role-scoped startup prompt construction; Lead-only branch/worktree/acceptance/reclaim/cleanup/Issue rules excluded; role-critical content preserved | executor | MET | `New-RoleAssignment` in `scripts/pi-team.ps1:375–379`; `Start-Task` calls it for both `executor` and `reviewer` at lines 387–388; Researcher untouched (already role-scoped at line 407); per-role positive/negative assertions in `tests/team-contract.test.mjs` |
| **C-003** — Reviewer independently re-verifies launch parameters / prompt construction, exclusion + retention tests, public lifecycle and communication behavior | reviewer | MET | This report; V1–V8 reproduced below. |
| **C-004** — Lead-reproducible verification: Lead-only text absent, role-critical retained, three role paths and lifecycle behavior unchanged | executor | MET | `tests/run-tests.ps1` → 42/42 pass; static diffs V1, V2, V3, V5, V6, V7; dynamic V8 reproduced by Reviewer from this worktree |

## V1 — Static: `New-RoleAssignment` defined and called per role; Lead-only tokens absent

Reproduced in this worktree:

```
$ Select-String -Path scripts/pi-team.ps1 -Pattern 'New-RoleAssignment|Lead assignment\.|Frozen task contract:|Constraints: \$'
scripts\pi-team.ps1:375:function New-RoleAssignment($Contract,[string]$Role) {
scripts\pi-team.ps1:379:  return "Lead assignment. Task ID: $($Contract.task_id). Worktree: $($Contract.worktree). Role: $Role. Delegation: $($delegation[0].id). Artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Done criteria: $criteria."
scripts\pi-team.ps1:387:  $executorAssignment = New-RoleAssignment $c 'executor'
scripts\pi-team.ps1:388:  $reviewerAssignment = New-RoleAssignment $c 'reviewer'
scripts\pi-team.ps1:407:  $assignment = "Lead assignment. Task ID: $($s.task_id). Worktree: $($s.worktree). Research delegation: $($delegation[0].id). Research artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Answer exactly this question: $q"
```

→ Confirmed: `New-RoleAssignment` defined once and called twice (executor + reviewer). `Lead assignment.` only appears inside the role-local template and the existing Researcher template at line 407 (Researcher line unchanged). `Frozen task contract:` is absent everywhere. `Constraints: $` (the Lead-only field interpolation) is absent.

## V2 — Static: `$c.constraints` no longer flows into any role prompt

```
$ Select-String -Path scripts/pi-team.ps1 -Pattern 'constraints'
scripts\pi-team.ps1:158:  foreach ($n in @('version','task_id','name','description','base_ref','branch','worktree','in_scope','out_of_scope','done_criteria','delegations','constraints')) { if ($null -eq $c.$n) { Fail "contract missing field: $n" } }
```

→ Confirmed: the only remaining reference is the `Parse-Contract` schema check. The Lead-only value is no longer projected into any role prompt. Contract schema is preserved so `Sync-Task`, `Accept`, and downstream tests keep working.

## V3 — Static: role markdown / skill / policy / Blackboard untouched

```
$ git diff -- .pi/agents .pi/skills .pi/communication plugins/agent-blackboard/
(empty)
```

→ Confirmed: capability isolation contract (`Get-RoleCapabilities` + `RoleArguments`), intercom topology (`BOUNDED_PEERS` / `SUPERVISOR_REASONS` / `SAFE_INTERCOM_ACTIONS`), runtime policy enforcement, and Blackboard MCP wiring are all byte-identical to `develop`.

## V4 — Dynamic: deterministic test suite passes (42/42)

Reproduced from this worktree:

```
$ powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1
ℹ tests 42
ℹ suites 0
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 31273.6772
```

The critical test is `"role launchers inject common-dir identity and isolate Executor/Reviewer environments"` in `tests/team-contract.test.mjs`. Inside this test:
- The previous contract-path positive assertion was inverted to a negative assertion.
- A per-role positive/negative assertion block was added (Role, Delegation, Artifact, Required capabilities, Objective, Done criteria positive; Frozen task contract, Read that exact contract, `\bConstraints:`, `[owner=`, cross-role delegation ids, `RESEARCH-001` negative).
- The test runs the full fake-launcher integration (fake `wt.exe`, fake `pi.cmd`, real PowerShell launcher, real state JSON, real Blackboard JSON, real role-launcher identity injection) and proves both Lead-only exclusion and role-critical inclusion end-to-end.

The complementary communication-policy (15/15) and blackboard (7/7) suites confirm no capability boundary, peer boundary, or Blackboard wiring regressed.

## V5 — Static: `state.contract_path` is still the single authoritative Lead-side pointer

```
$ Select-String -Path scripts/pi-team.ps1 -Pattern 'contract_path'
scripts\pi-team.ps1:385:  $state = [pscustomobject]@{...;contract_path=$contractSnapshot;...}
scripts\pi-team.ps1:400:  $contract=Parse-Contract $s.contract_path
scripts\pi-team.ps1:417:  Launch-Role ... "Re-read the frozen task contract at $($s.contract_path) ..."
scripts\pi-team.ps1:432:  $contract=Parse-Contract $s.contract_path
scripts\pi-team.ps1:449:  $contract=...Parse-Contract $s.contract_path
```

→ Confirmed: `state.contract_path` is written in `Start-Task` and read by `Research`, `Resume-Task`, `Accept`, `Close-Incomplete`. It does **not** appear in `New-RoleAssignment`, in `Launch-Role`'s initial-prompt argument, or anywhere in the new `Start-Task` assignment construction.

Note: `Resume-Task` (line 417) still references `contract_path` in its assignment string. This is **intentionally out of scope** for Issue #1 (see Researcher § R2). The Reviewer confirms Resume is not in the C-002 scope; if a future Issue extends the boundary treatment to Resume, the same `New-RoleAssignment` pattern + negative test extension applies.

## V6 — Static: `RoleArguments` and `Get-RoleCapabilities` unchanged

```
$ node -e "const fs=require('fs');const s=fs.readFileSync('scripts/pi-team.ps1','utf8');console.log('RoleArguments:',s.includes('function RoleArguments'));console.log('Get-RoleCapabilities:',s.includes('function Get-RoleCapabilities'));console.log('Researcher web-access:',s.includes('pi-web-access/index.ts'));"
RoleArguments: true
Get-RoleCapabilities: true
Researcher web-access: true
```

→ Confirmed: capability isolation is intact. `--no-extensions`, `--no-skills`, `--tools <role-specific>`, `--skill <role-specific>`, `--append-system-prompt <role.md>`, and the four `--extension` switches (intercom, role policy, report-to-lead, blackboard-update) all remain as before. Researcher continues to additionally load `pi-web-access` exclusively.

## V7 — Static: Blackboard plugin / `Assert-BlackboardTask` unchanged

```
$ git diff -- plugins/agent-blackboard/
(empty)
```

→ Confirmed: Blackboard wiring byte-identical.

## V8 — Dry-run: `New-RoleAssignment` per-role output, Lead-only token scan, cross-role leakage scan, self-role retention scan

Reproduced from this worktree by Reviewer (script created under `tests/_reviewer-v8-dryrun.ps1`, run, and removed afterward):

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

===== cross-role leakage scan =====
ABSENT executor has REVIEW-ISSUE-001
ABSENT executor has RESEARCH-ISSUE-001
ABSENT reviewer has EXECUTOR-ISSUE-001
ABSENT reviewer has RESEARCH-ISSUE-001
ABSENT researcher has EXECUTOR-ISSUE-001
ABSENT researcher has REVIEW-ISSUE-001

===== self-role retention scan =====
PRESENT executor has EXECUTOR-ISSUE-001
PRESENT executor has C-002
PRESENT reviewer has REVIEW-ISSUE-001
PRESENT reviewer has C-003
PRESENT researcher has RESEARCH-ISSUE-001
PRESENT researcher has C-001
```

→ Confirmed: each role's prompt contains only its own delegation id, artifact path, capability list, objective, and self-owned done criterion. Lead-only tokens (`Constraints:`, `Frozen task contract:`, `Read that exact contract`, `[owner=`, `Lead acceptance only`, `reclaim and cleanup`, `record in GitHub Issue`) are ABSENT from all three role prompts. No cross-role leakage. Self-role content is PRESENT for all three roles.

## Diff scope verification

```
$ git status --short
 M scripts/pi-team.ps1
 M tests/team-contract.test.mjs
?? implementation_notes/ISSUE-001.md
?? reports/ISSUE-001-review.md            (this file)
?? reports/ISSUE-001-verification.md
?? research/ISSUE-001-prompt-boundaries.md
?? .pi/skills/answer-research-question/helper-encode.mjs   (Researcher-process side effect; see Observation R-1 below)
?? intercom-outbox/                                              (empty; Reviewer did not send any outbound message during this review)
```

Production-code paths touched in this slice:
- `scripts/pi-team.ps1` — New-RoleAssignment at lines 375–379; Start-Task calls at lines 387–388 (5 lines removed, 6 lines added; no other production-code change)
- `tests/team-contract.test.mjs` — contract-path assertion flipped + per-role positive/negative block added inside the existing "role launchers inject common-dir identity and isolate Executor/Reviewer environments" test

Untracked artifacts (out of production-code scope):
- `implementation_notes/ISSUE-001.md` (Executor notes)
- `reports/ISSUE-001-verification.md` (Executor verification)
- `reports/ISSUE-001-review.md` (this Reviewer report)
- `research/ISSUE-001-prompt-boundaries.md` (Researcher C-001)
- `intercom-outbox/` (empty; created by the runtime during prior communication)
- `.pi/skills/answer-research-question/helper-encode.mjs` (Researcher-process side effect; see Observation R-1)

The public CLI verbs (`publish` / `validate` / `start` / `sync` / `research` / `status` / `watch` / `resume` / `accept` / `close-incomplete` / `reconcile` / `reclaim` / `cleanup` / `setup` / `codex-setup` / `doctor`), the task lifecycle (`active` / `accepted` / `incomplete` / `reclaimed` / `cleaned`), the Blackboard wiring, the intercom topology, the role capability isolation contract, the role markdown files, and the skill markdown files are all **byte-identical to `develop`** per V3 / V6 / V7.

## Observations (non-blocking, for Lead awareness)

### R-1. Researcher-process helper artifact `.pi/skills/answer-research-question/helper-encode.mjs`

The Reviewer observed an untracked file `.pi/skills/answer-research-question/helper-encode.mjs` (956 bytes; created 2026-08-29 13:56 local; not committed). It contains a Node.js script that emits an `agent-team/v1` envelope with a default body that references "New-RoleAssignment $c $Role", "tests/team-contract.test.mjs:319", and the proposed minimal split — i.e., a baked sketch of the expected answer.

The implementation_notes for this slice explicitly acknowledge this file (`implementation_notes/ISSUE-001.md` § Remaining risks), classify it as "Researcher process scratch", and assert `.pi/skills/` is git-ignored.

Reviewer finding:
- `.pi/skills/` is **not** in `.gitignore` (`git check-ignore -v .pi/skills/answer-research-question/helper-encode.mjs` returned nothing; `git status --porcelain .pi/skills/` shows `?? helper-encode.mjs`). The implementation_notes claim is factually incorrect.
- The Researcher's substantive artifact at `research/ISSUE-001-prompt-boundaries.md` (~35 KB, ~5200 words) contains concrete line-number citations (`scripts/pi-team.ps1:108-118`, `…:158`, `…:322-339`, `…:375-379`, `…:402-407`, `…:430-449`, `…:451-462`, `…:464-466`), comprehensive R1–R8 compatibility analysis, and a precise S1–S6 minimal-split proposal that maps 1:1 to the Executor's `New-RoleAssignment` implementation. The substantive depth of the artifact substantially exceeds the helper's default-body sketch (≈150 chars), so the Reviewer concludes the substantive artifact is genuine work and the helper-encode.mjs is a side artifact of the Researcher's process rather than the source of the artifact.
- The implementation_notes claim `.pi/skills/` is git-ignored is a documentation error in the notes file. It does not affect the implementation or test outcomes.

This observation is **non-blocking** for C-002 / C-004 (the implementation slice). However, the Reviewer flags it to Lead as:
- A potential research-process hygiene concern: future Researcher sessions on this same task may re-discover the helper file and treat it as authoritative.
- A factual error in `implementation_notes/ISSUE-001.md` § Remaining risks that Lead may want corrected.
- A candidate for explicit cleanup or for an addition to `.gitignore` so that future helper files do not leak into the worktree.

### R-2. Resume-Task still injects `contract_path` in its prompt

`scripts/pi-team.ps1:417` still emits `"Re-read the frozen task contract at $($s.contract_path)"` for the Executor and Reviewer sessions on Resume. This is **intentionally out of scope** for Issue #1 per Researcher § R2. The Reviewer confirms this is consistent with the task contract's in-scope list and the Researcher's R2 compatibility note. A future Issue may extend the `New-RoleAssignment` pattern to Resume; that work is not part of this slice.

### R-3. Researcher runtime path is not exercised by the new test block

The new per-role positive/negative assertions in `tests/team-contract.test.mjs` cover the Executor and Reviewer launch paths (which are produced by `Start-Task` → `Launch-Role` and recorded by `waitForRecords(2)`). The Researcher launch path is exercised in the same test block immediately after (`run("research", [taskId, "RESEARCH-001", questionFile])` and `waitForRecords(1)`) but the new prompt-content assertions are not duplicated for the Researcher record. This is acceptable because:
- The Research function at `scripts/pi-team.ps1:407` is byte-identical to its pre-Issue-1 form and was already role-scoped before this slice.
- V8 above independently confirms that calling `New-RoleAssignment $c 'researcher'` against a realistic ISSUE-001-shaped contract produces a Researcher prompt with only role-scoped content and no Lead-only leakage.

This is an explicit, documented choice in the Researcher's S5 recommendation and the implementation_notes ("inside the existing 'role launchers inject common-dir identity' test rather than a separate top-level test"). The Reviewer agrees it is acceptable.

### R-4. Test count stays at 42

The change is in-place inside the existing "role launchers inject common-dir identity and isolate Executor/Reviewer environments" test rather than a new top-level test, per the Researcher's S5 recommendation (avoids duplicating the heavy fake-launcher setup). The total test count remains 42 (20 + 15 + 7). The Reviewer considers this acceptable; Lead may require a separate top-level test in acceptance review if preferred, but no test was hidden or weakened.

## Verdict

- **C-001** (Researcher): MET — substantive artifact present and consistent with the implementation; cross-checked.
- **C-002** (Executor implementation): MET — `New-RoleAssignment` + per-role `Start-Task` calls in place; per-role positive/negative assertions added.
- **C-003** (Reviewer): MET — this report with V1–V8 reproduced from this worktree.
- **C-004** (Lead-reproducible verification): MET — 42/42 tests pass; static diffs V1, V2, V3, V5, V6, V7 reproduced; V8 dry-run reproduced.

**REVIEW PASS** for the Executor slice of ISSUE-001.

## Handoff to Lead

- Persistent pair remains alive. No commit, no reclaim, no cleanup performed by Reviewer.
- The two observations R-1 and R-2 above are non-blocking and do not change the verdict.
- Reviewer recommends Lead acceptance of this slice; Lead may decide whether R-1 requires a corrective cycle (clean up `.pi/skills/answer-research-question/helper-encode.mjs`, fix the git-ignore claim in `implementation_notes/ISSUE-001.md`, and/or add `.pi/skills/answer-research-question/helper*.mjs` to `.gitignore`) or a separate Issue.

End of Reviewer report.