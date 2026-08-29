# ISSUE-001 — Executor Implementation Notes

- Lead task ID: **ISSUE-001**
- Delegation ID: **EXECUTOR-ISSUE-001**
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-001`
- Branch: `pi-team/ISSUE-001-role-prompt-boundaries` (base ref `develop`)
- Slice state: READY_FOR_REVIEW
- Date: capture-time only (see git log)

## Research request / result correlation

The Researcher (delegation `RESEARCH-ISSUE-001`, capability set `read,grep,find,ls,write,report_to_lead,blackboard_update`) completed the C-001 read-only review before this Executor slice began its substantive edits. Per the workflow, the Executor did not block waiting for the artifact; the bounded proposal at `research/ISSUE-001-prompt-boundaries.md` was inspected once available and its § "最小安全拆分建议" (S1–S8) was adopted as the implementation plan.

- **Request**: implicit through the task contract (C-001 — Researcher identifies Lead-only vs role-critical in Start-Task assignment and proposes minimal safe split).
- **Artifact**: `research/ISSUE-001-prompt-boundaries.md` (~35 KB; 200+ numbered lines covering R1–R8 compatibility risks, Lead-only/role-critical split, and V1–V8 reproducible commands).
- **Researcher `RESEARCH_RESULT` envelope** (correlation_id `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`, broker delivered 2026-08-29T13:04:40.230Z, receiver received 2026-08-29T13:04:40.228Z): body decoded to `Artifact ready. Confidence: high.`
- **Decision impact**: adopted S1 (per-role template via `New-RoleAssignment`) verbatim; S2 (constraints field retained in schema, removed from prompt) implemented exactly; S3 (no changes to role markdown / skill / tool isolation) verified by V3 + V7; S5 (test changes) executed exactly — contract-path assertion flipped and per-role positive/negative block added inside the existing "role launchers inject common-dir identity" test rather than a separate top-level test (avoids duplicating the heavy fake-launcher setup); S6 (acceptance evidence) maps 1:1 to `reports/ISSUE-001-verification.md`.
- **Researcher artifacts the Executor did NOT use**: none — the only artifact produced is `research/ISSUE-001-prompt-boundaries.md`, which is the source-of-truth for the implementation plan.
- **No new bounded research request was opened** during the Executor slice; the existing proposal was sufficient for the in-scope change.


## Scope delivered

Per Lead assignment C-002 / C-004 and the EXECUTOR-ISSUE-001 delegation, this slice delivers the Issue #1 fix: role-scoped assignment construction so the Lead-only constraints (branch/worktree preparation, acceptance, reclaim, cleanup, Issue recording) no longer leak into the startup prompt of Executor / Reviewer / Researcher, while keeping the public CLI, task lifecycle, Blackboard, intercom, and role capability isolation contract unchanged.

The implementation is the smallest coherent change that satisfies Issue #1 and the Researcher's bounded proposal (`research/ISSUE-001-prompt-boundaries.md` § "最小安全拆分建议"):

1. **New `New-RoleAssignment` PowerShell function** in `scripts/pi-team.ps1` that builds a per-role prompt by filtering the contract's `delegations` and `done_criteria` by the role's `role`/`owner` field, replacing the previous single shared assignment string.
2. **`Start-Task` updated** to call `New-RoleAssignment` separately for `executor` and `reviewer`, then append the existing role-identity suffix and pass the prompt to `Launch-Role`. The Research function's role-scoped assignment (already aligned) is left untouched.
3. **Test updates** in `tests/team-contract.test.mjs`:
   - Inverted the contract-path assertion: initial assignment must **not** name the frozen contract snapshot (state.contract_path remains the Lead-side pointer).
   - Added positive assertions per role: prompt must declare `Role:`, `Delegation:` (self only), `Artifact:`, `Required capabilities:`, `Objective:`, `Done criteria:` (self only).
   - Added negative assertions per role: prompt must **not** contain `Frozen task contract:`, `Read that exact contract before acting`, the `Constraints:` field, `[owner=` annotations, any other role's `Delegation:` id, or the Researcher delegation id when the contract includes one.

## Files changed (worktree-relative paths)

```
 M scripts/pi-team.ps1
 M tests/team-contract.test.mjs
```

Diff against `develop..HEAD` is exactly these two files plus the Researcher-produced `research/ISSUE-001-prompt-boundaries.md`. No other file in the repo was modified by this Executor slice.

The full text diff of `scripts/pi-team.ps1` is:

```diff
@@ -372,16 +372,21 @@ function Launch-Role(...) {
   $runtime=Wait-RoleReady $State $Role $launchId
   ...
 }
+function New-RoleAssignment($Contract,[string]$Role) {
+  $delegation = @($Contract.delegations | Where-Object { $_.role -eq $Role })
+  if ($delegation.Count -ne 1) { Fail "contract must declare exactly one delegation for role $Role" }
+  $criteria = @($Contract.done_criteria | Where-Object { $_.owner -eq $Role } | ForEach-Object { "$($_.id): $($_.description) [artifacts=$($_.artifacts -join ',')]" }) -join '; '
+  return "Lead assignment. Task ID: $($Contract.task_id). Worktree: $($Contract.worktree). Role: $Role. Delegation: $($delegation[0].id). Artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Done criteria: $criteria."
+}
 function Start-Task([string]$Path) {
   ...
-  $criteria = @($c.done_criteria | ForEach-Object { "$($_.id): $($_.description) [owner=$($_.owner); artifacts=$($_.artifacts -join ',')]" }) -join '; '
-  $delegations = @($c.delegations | ForEach-Object { "$($_.id): $($_.role) -> $($_.artifact_path) [capabilities=$($_.required_capabilities -join ',')]" }) -join '; '
-  $assignment = "Lead assignment. Task ID: $($c.task_id). Worktree: $($c.worktree). Frozen task contract: $contractSnapshot. Read that exact contract before acting. Objective: $($c.description) Done criteria: $criteria. Role delegations: $delegations. Constraints: $($c.constraints -join '; ')."
-  try { Launch-Role $state 'executor' "$assignment You are Executor. Perform only the assigned slice and report progress through the configured tools." $state.sessions.executor.session_id; Launch-Role $state 'reviewer' "$assignment You are Reviewer. Inspect the delegated work as it becomes available and report progress through the configured tools." $state.sessions.reviewer.session_id }
+  $executorAssignment = New-RoleAssignment $c 'executor'
+  $reviewerAssignment = New-RoleAssignment $c 'reviewer'
+  try { Launch-Role $state 'executor' "$executorAssignment You are Executor. Perform only the assigned slice and report progress through the configured tools." $state.sessions.executor.session_id; Launch-Role $state 'reviewer' "$reviewerAssignment You are Reviewer. Inspect the delegated work as it becomes available and report progress through the configured tools." $state.sessions.reviewer.session_id }
   catch { ... }
   Write-Output "STARTED $($c.task_id) scope=$($state.scope_id)"
 }
```

The full text diff of `tests/team-contract.test.mjs` (excerpt) is:

```diff
-      assert.equal(record.args.some((arg) => arg.includes(contractSnapshot)), true, "initial assignment must name the frozen contract path");
+      assert.equal(record.args.some((arg) => arg.includes(contractSnapshot)), false, "initial assignment must not name the frozen contract path; state.contract_path remains the Lead-side pointer");
+    }
+    // Issue #1 — role-scoped assignment must include only role-critical content and exclude Lead-only text.
+    const roleDelegations = { executor: "EXECUTOR-001", reviewer: "REVIEWER-001" };
+    const initialPrompts = new Map(startRecords.map((record) => [record.role, record.args[record.args.length - 1]]));
+    for (const record of startRecords) {
+      const prompt = initialPrompts.get(record.role);
+      const delegationId = roleDelegations[record.role];
+      assert.match(prompt, new RegExp(`Role: ${record.role}\\b`), `${record.role} prompt must declare its role identity`);
+      assert.match(prompt, new RegExp(`Delegation: ${delegationId}\\b`), `${record.role} prompt must declare its own delegation id`);
+      assert.match(prompt, /Artifact: /, ...);
+      assert.match(prompt, /Required capabilities: /, ...);
+      assert.match(prompt, /Objective: /, ...);
+      assert.match(prompt, /Done criteria: /, ...);
+      assert.doesNotMatch(prompt, /Frozen task contract:/, ...);
+      assert.doesNotMatch(prompt, /Read that exact contract before acting/, ...);
+      assert.doesNotMatch(prompt, /\bConstraints: /, ...);
+      assert.doesNotMatch(prompt, /\[owner=/, ...);
+      // ... cross-role delegation id checks + RESEARCH-001 absence ...
     }
```

## Public CLI / lifecycle / Blackboard / intercom / capability isolation — unchanged

| Surface | Touched? | Evidence |
| --- | --- | --- |
| Public CLI verbs (`publish`/`validate`/`start`/`sync`/`research`/`status`/`watch`/`resume`/`accept`/`close-incomplete`/`reconcile`/`reclaim`/`cleanup`/`setup`/`codex-setup`/`doctor`) | NO | `git diff -- scripts/pi-team.ps1` only touches `New-RoleAssignment` and the assignment-construction lines inside `Start-Task` |
| Task lifecycle (`active` / `accepted` / `incomplete` / `reclaimed` / `cleaned`) | NO | `Accept`/`Close-Incomplete`/`Reconcile`/`Reclaim`/`Cleanup` unchanged; they still read `state.contract_path` |
| `state.contract_path` (Lead-only authoritative pointer) | NO | Still written in `Start-Task` (line 385); still read by `Accept`/`Close-Incomplete`/`Research`/`Resume-Task` |
| Blackboard (`Assert-BlackboardTask`, `Invoke-BlackboardLifecycle`, `plugins/agent-blackboard/`) | NO | `git diff -- plugins/agent-blackboard/` empty |
| `intercom` topology (`BOUNDED_PEERS`, supervisor reasons, audit dirs) | NO | `git diff -- .pi/communication/` empty |
| Role capability isolation (`Get-RoleCapabilities`, `RoleArguments`, `--no-extensions` / `--no-skills` / `--tools` / `--skill` / `--append-system-prompt` / `--extension` switches) | NO | Both functions still defined with identical content; Researcher still loads `pi-web-access` only |
| Role markdown / skill files | NO | `git diff -- .pi/agents .pi/skills` empty; `--append-system-prompt` still points to the same role files |
| `Resume-Task` contract-path pointer | NO | Still injects contract_path into Resume prompt (Issue #1 scope explicitly excludes Resume per Researcher § R2) |

## Validation performed

### V1. Static check on `scripts/pi-team.ps1`

`Select-String -Path scripts/pi-team.ps1 -Pattern 'New-RoleAssignment|Lead assignment\.|Frozen task contract:|Constraints: $'`:

```
scripts\pi-team.ps1:375:function New-RoleAssignment($Contract,[string]$Role) {
scripts\pi-team.ps1:379:  return "Lead assignment. Task ID: $($Contract.task_id). Worktree: $($Contract.worktree). Role: $Role. Delegation: $($delegation[0].id). Artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Done criteria: $criteria."
scripts\pi-team.ps1:387:  $executorAssignment = New-RoleAssignment $c 'executor'
scripts\pi-team.ps1:388:  $reviewerAssignment = New-RoleAssignment $c 'reviewer'
scripts\pi-team.ps1:407:  $assignment = "Lead assignment. Task ID: $($s.task_id). Worktree: $($s.worktree). Research delegation: $($delegation[0].id). Research artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Answer exactly this question: $q"
```

→ Result: `New-RoleAssignment` is defined and called for both `executor` and `reviewer`. `Frozen task contract:` is no longer present anywhere. `Constraints: $` (the start-task Lead-only field) is no longer present. The Researcher line at 407 (already role-scoped before Issue #1) is preserved unchanged.

### V2. Static check on `$c.constraints` / `$Contract.constraints`

`Select-String -Path scripts/pi-team.ps1 -Pattern 'constraints'`:

```
scripts\pi-team.ps1:158:  foreach ($n in @('version','task_id','name','description','base_ref','branch','worktree','in_scope','out_of_scope','done_criteria','delegations','constraints')) { if ($null -eq $c.$n) { Fail "contract missing field: $n" } }
```

→ Result: the only remaining reference is the `Parse-Contract` schema check that requires `constraints` to exist. The field is no longer projected into any role prompt. The contract schema is preserved so existing Lead tooling (`Sync-Task`, etc.) and downstream tests keep working.

### V3. Static check on role markdown / skill / policy / blackboard

`git diff -- .pi/agents .pi/skills .pi/communication plugins/agent-blackboard/` → empty.

→ Result: zero unintended modifications. Role capability isolation contract is byte-identical.

### V4. Dynamic validation — `tests/run-tests.ps1`

`powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1`:

```
ℹ tests 42
ℹ suites 0
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms ~30000–40000
```

→ Result: 42/42 deterministic tests pass. Includes:
- The full `team-contract.test.mjs` suite (20 tests) covering active role presence, frontmatter, capability isolation, setup idempotency, role launchers (now exercising the new `New-RoleAssignment`), contract validation, acceptance criteria, role-event sequencing, tests-directory contract, and Lead session runbook.
- The full `communication-policy.test.mjs` suite (15 tests) covering peer topology, supervisor reasons, denial before context, audit/replay mechanics.
- The full `blackboard.test.mjs` suite (7 tests) covering common-dir root, formal publication, reconcile, append-only events, cursor watching, plugin MCP/UI exposure.

### V5. Static check on `state.contract_path`

`Select-String -Path scripts/pi-team.ps1 -Pattern 'contract_path'`:

```
scripts\pi-team.ps1:385:  $state = [pscustomobject]@{...;contract_path=$contractSnapshot;...}  # Start-Task writes it
scripts\pi-team.ps1:400:  $contract=Parse-Contract $s.contract_path                          # Research reads it
scripts\pi-team.ps1:417:  Launch-Role ... "Re-read the frozen task contract at $($s.contract_path) ..."  # Resume uses it (unchanged)
scripts\pi-team.ps1:432:  $contract=Parse-Contract $s.contract_path                          # Accept reads it
scripts\pi-team.ps1:449:  $contract=...Parse-Contract $s.contract_path                       # Close-Incomplete reads it
```

→ Result: `state.contract_path` is still the single authoritative pointer for all Lead-side code paths (Accept, Close-Incomplete, Research, Resume). It no longer appears in `New-RoleAssignment` or in the `Start-Task` initial assignment construction. Resume is unchanged by Issue #1 (out of scope per Researcher § R2).

### V6. Static check on `Get-RoleCapabilities` / `RoleArguments`

`node -e "...const src = readFileSync('scripts/pi-team.ps1','utf8'); console.log(src.includes('function RoleArguments')); console.log(src.includes('function Get-RoleCapabilities')); console.log(src.includes('pi-web-access/index.ts'));"`

→ Result: all three symbols are present. Researcher still loads `pi-web-access` exclusively.

### V7. Static check on Blackboard MCP / `Assert-BlackboardTask`

`git diff -- plugins/agent-blackboard/` → empty.

→ Result: Blackboard wiring byte-identical.

### V8. Dry-run of `New-RoleAssignment` with a realistic contract

A one-off PowerShell extraction (`tests/role-assignment-dryrun.ps1`, removed after verification to keep the tests directory clean) parsed `scripts/pi-team.ps1`, isolated the `New-RoleAssignment` function via regex, and invoked it against a hand-built contract mirroring the ISSUE-001 task contract. Output:

```
===== executor =====
Lead assignment. Task ID: ISSUE-001. Worktree: D:/Coding/Harness/Pi-team-ISSUE-001. Role: executor. Delegation: EXECUTOR-ISSUE-001. Artifact: reports/ISSUE-001-verification.md. Required capabilities: bash, write. Objective: Implement boundary fix. Done criteria: C-002: Executor implements [artifacts=implementation_notes/ISSUE-001.md].

===== reviewer =====
Lead assignment. Task ID: ISSUE-001. Worktree: D:/Coding/Harness/Pi-team-ISSUE-001. Role: reviewer. Delegation: REVIEW-ISSUE-001. Artifact: reports/ISSUE-001-review.md. Required capabilities: read, bash. Objective: Review boundary fix. Done criteria: C-003: Reviewer reviews [artifacts=reports/ISSUE-001-review.md].

===== researcher =====
Lead assignment. Task ID: ISSUE-001. Worktree: D:/Coding/Harness/Pi-team-ISSUE-001. Role: researcher. Delegation: RESEARCH-ISSUE-001. Artifact: research/ISSUE-001-prompt-boundaries.md. Required capabilities: read, write. Objective: Research boundaries. Done criteria: C-001: Researcher reads [artifacts=research/ISSUE-001-prompt-boundaries.md].
```

`Select-String -Pattern 'Constraints|Frozen task contract|Read that exact contract|owner='` against this output → no matches. Each role prompt contains only its own delegation id, artifact path, capabilities, objective, and done criteria. Cross-role leakage is absent. The Lead-only `constraints` field (containing "Lead acceptance only after Reviewer pass; reclaim and cleanup after acceptance; record in GitHub Issue") does not appear in any role prompt.

## Mapping to Issue #1 done criteria

| Criterion | Owner | Status | Evidence |
| --- | --- | --- | --- |
| **C-001** — Researcher reads the current Start-Task assignment, distinguishes Lead-only vs role-critical, proposes minimal safe split | researcher | MET | `research/ISSUE-001-prompt-boundaries.md` produced before this Executor slice (in this same task session) |
| **C-002** — Executor implements role-scoped startup prompt construction; Lead-only branch/worktree/acceptance/reclaim/cleanup/Issue rules excluded; role-critical objective/artifact/capabilities/safety/peer/report preserved | executor | MET | `New-RoleAssignment` in `scripts/pi-team.ps1` (lines 375-379); `Start-Task` calls it for both `executor` and `reviewer` (lines 387-388); Researcher untouched (already role-scoped at line 407); per-role positive/negative assertions in `tests/team-contract.test.mjs` |
| **C-003** — Reviewer independently re-verifies | reviewer | PENDING | Handoff to paired Reviewer `pi-team--ISSUE-001--reviewer` |
| **C-004** — Lead-reproducible verification: Lead-only text absent, role-critical retained, three role paths + lifecycle behavior unchanged | executor | MET | `tests/run-tests.ps1` → 42/42 pass; static diffs V1–V8 above; `reports/ISSUE-001-verification.md` is the dedicated Lead-reproducible artifact |

## Remaining risks / open items

- **Resume-Task still injects `contract_path`** in its prompt (`scripts/pi-team.ps1:417`). This is intentionally out of scope per Researcher § R2 (Issue #1 explicitly excludes Resume). If a future Issue requires the same boundary treatment for Resume, the same `New-RoleAssignment` pattern + negative test extension applies; the static check `Select-String -Pattern 'Re-read the frozen task contract at'` would surface the change.
- **Researcher's helper artifact** at `.pi/skills/answer-research-question/helper-encode.mjs` (untracked, 956 bytes) was created during the Researcher's process and is not part of this slice. It does not affect any test or runtime surface. Reviewer confirmed `.pi/skills/` is NOT git-ignored (`git check-ignore -v .pi/skills/` returns empty); the file remains untracked but is visible in `git status`. Reviewer R-1 also notes the file's default body references the expected answer, so Reviewer judged the substantive `research/ISSUE-001-prompt-boundaries.md` artifact by cross-checking its line-number citations and S1–S6 mapping against the implementation, which matched 1:1. Flagged to Lead for hygiene decision. The Executor does not own the helper file.
- **Test count stays at 42**; the change is in-place inside the existing "role launchers inject common-dir identity and isolate Executor/Reviewer environments" test rather than a new top-level test, per the researcher's `S5` recommendation to avoid duplicating the heavy fake-launcher setup. Lead can require a separate top-level test in review if preferred.
- **Lead-side state visibility**: `state.contract_path` is still populated and exposed through `pi-team.cmd status`; Accept/Reclaim continue to use it as the single source of truth. No Lead-side script or AGENTS.md change was made.

## Handoff to paired Reviewer

- Paired Reviewer target (via `intercom list-cwd` in this worktree): `pi-team--ISSUE-001--reviewer`.
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-001`
- Branch: `pi-team/ISSUE-001-role-prompt-boundaries`
- Implementation notes: `implementation_notes/ISSUE-001.md` (this file)
- Verification report: `reports/ISSUE-001-verification.md`
- Researcher's bounded proposal: `research/ISSUE-001-prompt-boundaries.md`
- Reviewer repro commands: `tests/run-tests.ps1` plus the V1–V8 `Select-String` / `git diff` commands listed above. Reviewer can also re-run the dry-run by re-creating the one-off `.ps1` script from this notes file (the content is reproducible; the script was removed only to keep `tests/` clean).

End of Executor notes.
