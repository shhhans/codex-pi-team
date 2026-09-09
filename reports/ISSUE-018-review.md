# ISSUE-018 — Reviewer Report (REVIEW-ISSUE-018)

## Verdict

**REVIEW_PASS** — the Executor's implementation satisfies C-002 and C-004.
The optimization is correct, scoped, security-preserving, and its cost
evidence is sound and independently reproducible. One Researcher-owned
documentation inaccuracy is flagged for Lead triage (not a blocker).

## Scope and delegation

- Lead task: ISSUE-018 — 优化 Pi subagents 启动上下文注入 (GitHub Issue #9).
- Review delegation: REVIEW-ISSUE-018, done criterion C-003 (independent
  review of prompt/context, startup commands, permission and artifact
  boundaries, cost evidence, and negative tests; explicit verdict).
- Worktree: `D:/Coding/Harness/Pi-team-ISSUE-018`, branch `pi-team/ISSUE-018`
  (base ref `develop`; changes uncommitted, consistent with no Git commit
  authorization for Executor/Reviewer).
- Executor delegation: EXECUTOR-ISSUE-018; paired via intercom role route.

## Reviewed artifacts

- `implementation_notes/ISSUE-018.md` — Executor slice notes.
- `reports/ISSUE-018-verification.md` — Executor verification evidence.
- `research/ISSUE-018.md` and `research/ISSUE-018-issue-9-startup-context-injection.md`
  — Researcher bounded research (near-duplicates, see § Researcher artifact note).
- Working-tree diff: `scripts/pi-team.ps1` (+39/−6) and
  `tests/team-contract.test.mjs` (+207, additions only).

## Scope verification

The tracked diff is exactly two files:

```
 scripts/pi-team.ps1          |  39 ++++++--
 tests/team-contract.test.mjs | 207 +++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 240 insertions(+), 6 deletions(-)
```

No changes to `.pi/agents`, `.pi/skills`, `.pi/communication`,
`plugins/agent-blackboard`, `README.md`, `ADR/`, `project_state.md`,
`architect.md`, `goal.md`, `AGENTS.md`, `scripts/pi-team.cmd`,
`tests/run-tests.ps1`, `tests/communication-policy.test.mjs`,
`tests/blackboard.test.mjs` (all `git diff --stat` empty). No public CLI
verb, lifecycle state machine, capability allowlist, Blackboard wiring, or
intercom topology was touched. New artifacts (`implementation_notes/ISSUE-018.md`,
`reports/ISSUE-018-verification.md`, research docs) are the contract-owned
paths. Scope is compliant.

## Production diff review (`scripts/pi-team.ps1`)

### 1. `New-RoleContext` start-mode consolidation

The previous start prompt referenced `AGENTS.md` and `ADR/0002` twice each
(Stable project context + Recommended common reads; Normative protocol +
Recommended common reads). The diff collapses the three lines into one
consolidated `Stable project context` line that names `AGENTS.md`,
`project_state.md`, and `ADR/0002-lead-subagent-collaboration-protocol.md`
exactly once, and removes the standalone `Normative protocol` line and the
`Recommended common reads` line. Per-role `Recommended role reads` are
preserved verbatim.

Verified independently (dot-source + `New-RoleContext` with a realistic
v2 contract):

| Metric | Baseline (`develop`) | After diff |
| --- | --- | --- |
| Executor prompt bytes | 1580 | **1523** (−57, −3.6%) |
| AGENTS.md occurrences | 2 | **1** |
| ADR/0002 occurrences | 2 | **1** |
| Reviewer prompt bytes | — | 1472 |
| Researcher (research-mode) bytes | — | 1543 |

All required fields remain present: `Task ID`, `Role`, `Branch`, `Worktree`,
`Delegation`, `Owned artifact`, `Required capabilities`, `Objective`,
`Visible scope`, `Out of scope`, `Owned done criteria`, `Tool runtime
metadata`, `Recommended role reads`. The reduction is real, reproducible,
and matches the Executor's recorded `EXECUTOR_LEN=1523`.

### 2. `Research` function R1 fix

The previous `$assignment` re-declared six fields already emitted by
`New-RoleContext 'researcher' 'research' $q` (Task ID, Worktree, Delegation,
Artifact, Required capabilities, Objective), two under alias names. The diff
collapses this to:

```powershell
$assignment = "$(New-RoleContext $contract 'researcher' 'research' $q) Lead assignment. Answer exactly this question: $q"
```

Verified: `New-RoleContext` emits all six fields for the researcher role
(plus `Research question:`), so no information is lost. `Lead assignment.`
and `Answer exactly this question: $q` (the action constraint) are preserved.
`$delegation[0]` is still used for `Assert-DelegationCapabilities`, the
artifact path, and the session record — no dangling reference. The change
saves ~250 bytes per on-demand Research launch.

### 3. `Get-ToolRuntimeMetadata` defensive `Fail()` loop

Three `[string]::IsNullOrEmpty → 'unknown'` guards on `os_family`,
`os_version`, `os_architecture`, plus a `foreach` loop that calls `Fail()`
(which `throw`s) if any of the five required field labels
(`os_family=`, `os_version=`, `os_architecture=`, `command_interpreter=`,
`command_syntax_examples=`) is missing from the produced line.

Verified: `Fail` is `function Fail([string]$Message) { throw $Message }`
(script line 11), so a missing field prevents role launch. This hardens the
boundary — an optimization cannot silently drop runtime metadata. The
`command_interpreter` fallback chain (`$PSVersionTable` → `$env:SHELL` →
`$env:ComSpec` → `'unknown'`) is unchanged and correct.

## Security boundary review

No security check was relaxed or removed. The following remain untouched
(verified by `git diff --stat` on the relevant paths and source inspection):
`Parse-Contract`, `Assert-RelativeArtifactPath`, `Get-RoleCapabilities`,
`Assert-DelegationCapabilities`, `Assert-BlackboardTask`,
`Assert-ReviewerReadyForAcceptance`, `Assert-NoLiveRoleProcesses`,
`Get-SetupIssues`, `Set-WebAccessAutoloadDisabled`, `Assert-Setup`,
`Start-RoleProcess`, `Wait-RoleReady`, and the Blackboard/intercom wiring.

The optimization treats missing environment info as **more** strict (Fail()
on missing runtime-metadata fields), which is the correct security posture:
missing info is surfaced as `unknown` or rejected, never silently elided to
bypass a boundary. Task/worktree/scope/role binding and artifact-ownership
validation are unchanged.

## Test review (`tests/team-contract.test.mjs`)

Three new deterministic tests (additions only; no existing test modified or
removed):

1. **`ISSUE-018: Get-ToolRuntimeMetadata keeps every required field and
   exposes the defensive Fail() check`** (line 902) — runs
   `Get-ToolRuntimeMetadata` with `env:SHELL` removed, asserts all five
   required fields appear; asserts the source contains the `Fail()`
   defensive loop and its per-field enumeration.
2. **`ISSUE-018: New-RoleContext deduplicates redundant navigation hints
   and stays under the size budget`** (line 946) — asserts `< 1600` byte
   budget for executor/reviewer, `< 1700` for researcher; asserts old
   `Recommended common reads:` and standalone `Normative protocol:` lines
   are gone and the consolidated line is present; asserts byte-level
   inequality between executor and reviewer prompts; covers the researcher
   research-mode prompt; asserts `New-RoleContext` does not emit
   `Lead assignment.` (R1 negative control).
3. **`ISSUE-018: independent worktree paths flow into each role prompt
   without leaking cross-task paths`** (line 1057) — drives `New-RoleContext`
   with two contracts having different worktree paths and asserts each
   prompt contains only its own worktree path (cross-leak negative control).

Independent reproduction:

```
node --test --test-name-pattern "ISSUE-018" tests/team-contract.test.mjs
→ pass 3, fail 0   (447 ms / 1488 ms / 771 ms)
```

The four required coverage areas map to the actual tests: three roles normal
(tests 1–2, including research mode), independent worktree (test 3),
permission differences (test 2 byte inequality), missing environment info
(test 1). All negative controls hold.

Minor rigor observation (not a failure): the "exactly once" property for
`AGENTS.md`/`ADR/0002` is enforced in practice by `assert.doesNotMatch` on
the old lines plus `assert.match` on the consolidated line, not by an
explicit occurrence count. Independent measurement confirms ×1 for both in
the produced prompts; a future regression that re-introduced a duplicate
reference outside those two lines would not be caught by a count but the
existing negative assertions cover the documented duplication vector.

## Full-suite reproduction and the pre-existing failure

`tests/run-tests.ps1` reproduces exactly as claimed:

```
tests 92, pass 82, fail 1, cancelled 0, skipped 9, todo 0, duration ~48.7 s
```

The single failure (`acceptance requires each frozen criterion ID and
synchronizes the Blackboard outcome`, line 818) is **pre-existing and not
caused by this diff**:

- The failing path is `Accept` → `Assert-ReviewerReadyForAcceptance` →
  `Get-BlackboardTask` (line 235) → `blackboard-cli.mjs snapshot` → line 242
  `Fail 'Blackboard snapshot returned invalid JSON'`. This path is disjoint
  from the diff (which touches only `Get-ToolRuntimeMetadata`,
  `New-RoleContext`, `Research`).
- The acceptance test was last modified in commit `5078f4c`, not this slice.
- Root cause independently reproduced: the active ISSUE-018 Blackboard task
  contains Chinese text in `name`/`description` that gets corrupted when
  `node blackboard-cli.mjs snapshot` output is piped through PowerShell,
  producing bytes that fail `ConvertFrom-Json`. Direct node invocation
  produces valid JSON; the PowerShell pipe corrupts the multi-byte
  characters (`"name":"优化 Pi subagents 启动上下文注�?,` — closing quote
  lost). This is a Blackboard/encoding runtime issue independent of any
  working-tree state.
- The Executor's own `git stash` reproduction (pre-existing on `develop`)
  is consistent with this analysis; I did not re-run `git stash` since it
  requires explicit Lead authorization for worktree-changing operations.

## Cost evidence (C-004)

The cost claim is not based on startup logs. It is a deterministic prompt
byte measurement, independently reproduced:

- Baseline executor prompt: 1580 bytes; after: 1523 bytes (−57, −3.6%).
- Per task start (executor + reviewer): ~−114 bytes.
- Per on-demand Research launch: ~−250 bytes (R1 field de-duplication).
- Byte-budget assertion (`< 1600` executor/reviewer, `< 1700` researcher)
  is in the deterministic test suite and passes.

The reduction is modest but real, and it directly targets the Issue #9 goal
(reduce repeated directory/environment exploration prompts). The claim is
reproducible from the Node test suite alone (no Pi launch, no log scraping,
no LLM in the loop).

## Researcher artifact note (routed to Lead, not a blocker)

Both research artifacts (`research/ISSUE-018.md` and
`research/ISSUE-018-issue-9-startup-context-injection.md`, ~70 KB near-
duplicates with a 43-line diff being the added "Artifact path note" header)
claim **"4 条 ISSUE-018 测试" (4 tests)** exist at `tests/team-contract.test.mjs:902-1100`,
including a described test "Get-ToolRuntimeMetadata refuses to emit a
metadata line missing a required field" (lines 937–972) with an "exactly
5 fields separated by `; `" assertion.

Only **3 tests** exist in the implementation (lines 902, 946, 1057). The
described 4th test was merged into test #1 (which checks per-field presence
and the source Fail-loop but does **not** assert an exact `; `-separated
field count). The Executor's own implementation notes and verification
report accurately state 3 tests; the actual test coverage satisfies all four
required areas. This is a Researcher-owned documentation inaccuracy in the
research artifact, not an Executor implementation defect, and it does not
affect the security boundary or the correctness of the optimization. Per
ADR-0002, Researcher ↔ Reviewer direct communication is denied; this is
routed to Lead for triage (e.g., correct the research artifact's test count
or add the missing count assertion in a Lead-authorized follow-up).

The duplicate research files themselves (one with the policy-conforming
slug) are also worth Lead attention for artifact hygiene.

## Done-criterion mapping

| Criterion | Status | Evidence |
| --- | --- | --- |
| **C-002** — Executor optimizes startup injection/process; covers three roles normal, independent worktree, permission differences, missing environment info; tests or diagnostics prove reduced repeated exploration/time; negative validation maintains rejection | **MET** | `New-RoleContext` consolidation (AGENTS.md/ADR/0002 ×1 each, −57 bytes/prompt, measured); `Research` R1 (6-field dedup, −250 bytes); three new tests covering all four areas; negative controls (missing env → `Fail()`, cross-worktree leak, `Lead assignment.` absence) hold. |
| **C-004** — Lead independently runs complete and targeted tests and checks diff; confirms optimization does NOT treat missing environment info as ignorable, does NOT claim cost improvement based only on startup logs | **MET** | Diff limited to the two files; `Get-ToolRuntimeMetadata` Fail() loop hardens missing-env rejection; cost proven by deterministic byte measurement (1580→1523, independently reproduced), not startup logs. Full suite 82/92 with a verified pre-existing unrelated failure. |
| **C-003** — Reviewer independently reviews and writes explicit verdict | **MET** (this report) | See verdict above. |

## Remaining risks / open items for Lead

1. **Research artifact over-claim**: research docs state 4 ISSUE-018 tests;
   only 3 exist. Researcher-side documentation accuracy issue, routed to Lead.
2. **Pre-existing acceptance-test failure**: Blackboard snapshot
   Chinese-text encoding corruption breaks `ConvertFrom-Json` in the
   PowerShell pipe. Needs Lead-side triage (Blackboard/encoding fix), not
   part of this slice.
3. **Duplicate research files**: `research/ISSUE-018.md` and
   `research/ISSUE-018-issue-9-startup-context-injection.md` are
   near-duplicates; Lead may want to reconcile to a single canonical path.
4. **Minor test-rigor observation**: "exactly once" for AGENTS.md/ADR/0002
   is not count-asserted; acceptable, noted for completeness.

## Sign-off

Reviewer verdict: **REVIEW_PASS** for EXECUTOR-ISSUE-018. The implementation
is correct, scope-compliant, security-preserving, and its cost evidence is
reproducible. The paired fix/re-review loop is not needed for the Executor's
deliverable. Researcher artifact discrepancy and the pre-existing Blackboard
failure are routed to Lead.
