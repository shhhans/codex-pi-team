# Implementation Notes — BOOTSTRAP-SELF-003

## Lead task ID
`BOOTSTRAP-SELF-003`

## Cause
Active persistent-memory bindings in `.pi/agents/{researcher,executor,reviewer}.md`
contaminated active role behavior with stale memories from prior
lineages (Researcher Deep Research, an in-place generated Executor
runtime that contained transient worktree advice). The approved
minimal-loop design requires active roles to be defined only by their
role prompt plus one private skill under `.pi/skills/`. This task
removes the active memory bindings, archives the historical
researcher/reviewer memories under `.pi/legacy/agent-memory/`, deletes
the unsafe generated executor runtime directory, and tightens the
contract test so future regressions are caught.

## Files changed (inside the worktree)

### Production (role definitions)
- `.pi/agents/researcher.md` — removed complete `memory:` frontmatter
  block (`scope: project`, `path: researcher`); left all other
  frontmatter and body unchanged.
- `.pi/agents/executor.md` — removed complete `memory:` frontmatter
  block (`scope: project`, `path: executor`); left all other
  frontmatter and body unchanged.
- `.pi/agents/reviewer.md` — removed complete `memory:` frontmatter
  block (`scope: project`, `path: reviewer`); left all other
  frontmatter and body unchanged.

### Archived historical memories (verbatim, CRLF preserved)
- `.pi/legacy/agent-memory/researcher-deep-research/MEMORY.md` —
  copied byte-for-byte from the previously-tracked
  `.pi/agent-memory/researcher/MEMORY.md` (6758 bytes; CRLF).
- `.pi/legacy/agent-memory/reviewer/MEMORY.md` — copied byte-for-byte
  from the previously-tracked `.pi/agent-memory/reviewer/MEMORY.md`
  (101 bytes; CRLF).

### Removed
- `.pi/agent-memory/executor/` — the generated, ignored runtime
  directory created during BOOTSTRAP-SELF-002 that contained unsafe
  transient worktree advice. Deleted entirely (`rm -rf`); not
  archived as durable guidance.
- `.pi/agent-memory/researcher/MEMORY.md` — moved under legacy.
- `.pi/agent-memory/reviewer/MEMORY.md` — moved under legacy.

After the move, the active `.pi/agent-memory/` directory contains no
role memory files (empty `researcher/` and `reviewer/` subdirectories
remain; they are gitignored). `.pi/agent-memory/` itself stays in
`.gitignore`.

### Documentation
- `project_state.md` — added a header note to the Active agent surface
  stating active roles are defined by role prompt + private skill only
  and no active role binds persistent memory. Replaced the per-agent
  `Memory` column entries with `none (prompt + private skill only)`.
  Extended the Legacy preservation bullet for `.pi/legacy/agent-memory/`
  to list the two new archived historical buckets and the fact that
  active roles no longer bind memory.
- `architect.md` — reviewed; contains no claim that active roles
  require persistent memory. No edit made.

### Tests
- `tests/team-contract.test.mjs` — extended the active-role-definition
  test to assert no `memory:` key in frontmatter and no
  `^memory:\s*$` line in any of the three role files. Added a new
  test "active role memory files are absent and the executor runtime
  directory is removed" that asserts (a) no `MEMORY.md` files exist
  under `.pi/agent-memory/{researcher,executor,reviewer}/`, (b)
  `.pi/agent-memory/executor/` does not exist, and (c)
  `.pi/agent-memory/` contains no `.md` files. Extended the legacy
  preservation test to assert the two newly archived historical
  memories exist.

### Out of scope (explicitly untouched)
- Shared intercom policy/topology under `.pi/communication/`.
- Legacy payload contents under `.pi/legacy/`, including
  `.pi/legacy/PROVENANCE.md` (no new rows added; existing legacy
  contents left unchanged).
- Researcher web provider (`.pi/npm/node_modules/pi-web-access/index.ts`)
  and `subagentOnlyExtensions` wiring.
- Artifact contracts (`research/`, `implementation_notes/`,
  `failures/`).
- ADR `0001-minimal-development-loop.md` (does not explicitly claim
  active roles require persistent memory; no edit made).
- Role prompt bodies that mention role memory in descriptive prose
  (e.g., "Read your role memory before acting"). Those lines describe
  intended behavior; removing the frontmatter binding makes them
  vestigial but harmless. Per the Lead scope, only the `memory:`
  frontmatter blocks were removed; other role behavior and
  communication topology were left unchanged.

## Validation performed

| Command | Result |
| --- | --- |
| `node --check tests/team-contract.test.mjs` | passed (syntax check) |
| `node --test tests/team-contract.test.mjs` | passed (10/10 tests green) |
| `tests/run-tests.ps1` (via `tsx`) | passed (10/10 tests green) |
| `git diff --check` (see below) | passed with one expected whitespace warning on a pre-existing `.tmp-role-audit*/researcher.jsonl` line; see Risks |
| `python3 .../quick_validate.py .pi/skills/answer-research-question` | passed (`Skill is valid!`) |
| `python3 .../quick_validate.py .pi/skills/execute-delegated-task` | passed (`Skill is valid!`) |
| `python3 .../quick_validate.py .pi/skills/review-delegated-task` | passed (`Skill is valid!`) |

`node --test tests/team-contract.test.mjs` direct output summary:
`tests 10 / pass 10 / fail 0`. The new test
"active role memory files are absent and the executor runtime
directory is removed" is test 7; the extended legacy preservation test
is test 9.

`git status --short` after the work:
```
 M .pi/agents/executor.md
 M .pi/agents/researcher.md
 M .pi/agents/reviewer.md
 M project_state.md
 M tests/team-contract.test.mjs
 D .pi/agent-memory/researcher/MEMORY.md
 D .pi/agent-memory/reviewer/MEMORY.md
```
plus pre-existing modifications from prior tasks (e.g., `.gitignore`,
`.pi/communication/*`, `.tmp-role-audit*/*`). No new files were
staged; `git diff --cached --name-only` is empty. The accepted
noStagedFiles contract is satisfied for the changes introduced by
this task.

## Remaining risks

1. **Vestigial role-memory prose.** The body text of each active role
   still contains sentences such as "Read your role memory before
   acting. Persist only durable ...". With the `memory:` binding
   removed, these lines are descriptive relics rather than binding
   instructions. The Lead scope explicitly excluded role-body edits,
   so this is acknowledged residual risk, not a defect of this task.

2. **Pre-existing `git diff --check` whitespace warnings.** The
   worktree contains pre-existing modifications (from prior tasks)
   that produce whitespace warnings unrelated to BOOTSTRAP-SELF-003,
   including lines inside `.tmp-role-audit*/researcher.jsonl` files.
   The accepted convention (per Executor role memory and prior
   implementation notes) is to leave such pre-existing warnings
   untouched.

3. **Legacy `.pi/legacy/PROVENANCE.md` does not list the two new
   archived memories.** The provenance manifest was authored in
   BOOTSTRAP-SELF-002 and was not extended in this task to add the
   researcher-deep-research and reviewer historical moves, per the
   explicit "do not change legacy payload contents" constraint.
   Reviewer may decide whether to extend the provenance in a
   follow-up task; this is not a defect of this task.

4. **Line-ending preservation.** The archived historical memories
   retain CRLF line terminators (matching the existing legacy
   `architect/`, `critic/`, `engineer/` convention). Git's
   object-store representation normalizes CRLF to LF, so a future
   `git show HEAD:<path>` of the archived memory would return LF
   bytes; the on-disk legacy file remains CRLF verbatim.

## Stop signal

STOPPED_FOR_REVIEW. Executor has stopped inside the assigned worktree
`D:\Coding\Harness\Pi-team-bootstrap`. The paired Reviewer may enter
the worktree and exercise `review-delegated-task`. No commit, no
staging, no further edits by Executor.