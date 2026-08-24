# Implementation Notes — BOOTSTRAP-SELF-002

**Lead task ID:** BOOTSTRAP-SELF-002
**Worktree path:** D:\Coding\Harness\Pi-team-bootstrap
**Executor:** Executor
**Date:** 2026-08-24

**Status:** STOPPED_FOR_REVIEW

The Executor has stopped. Implementation, validation, and artifact
writes are complete. Paired Reviewer may now enter the worktree.

## Scope delivered

The minimal three-agent development loop cutover was implemented per
ADR 0001 in the assigned worktree. No commits were performed; nothing
was staged (`git status` reports "no changes added to commit").

## Change groups

### 1) Active agent surface (`.pi/agents/`)

- Kept `researcher.md`, `executor.md`, `reviewer.md`.
- Moved `architect.md`, `critic.md`, `engineer.md` unchanged to
  `.pi/legacy/agents/`.
- Added `subagentOnlyExtensions: ../npm/node_modules/pi-web-access/index.ts`
  to `.pi/agents/researcher.md` (frontmatter block list). The Researcher
  is wired to the installed `pi-web-access` 0.24.2 provider and exposes
  only `web_search`, `fetch_content`, `get_search_content`,
  `source_check`. Deep Research MCP tools are **not** wired.

### 2) Role-specific extension files (`.pi/communication/extensions/`)

- Kept `researcher.ts` and `reviewer.ts` (active roles).
- Moved `architect.ts`, `critic.ts`, `engineer.ts` unchanged to
  `.pi/legacy/communication/extensions/`.
- Shared intercom implementation (`policy.mjs`, `lifecycle.mjs`,
  `persistent-store.mjs`, `runtime-policy.mjs`, `send.mjs`,
  `pi-policy-extension.ts`, `canonical-plan.json`, `README.md`) is
  unchanged and active.

### 3) Role-specific audit logs and replay store

- Moved `.pi/communication/audit/architect.jsonl` and `critic.jsonl` to
  `.pi/legacy/communication/audit/`.
- Moved `.pi/communication/reply-store/architect/` and
  `.pi/communication/reply-store/engineer/` to
  `.pi/legacy/communication/reply-store/`.
- Kept the active `researcher.jsonl` and `reviewer.jsonl` audit logs
  in `.pi/communication/audit/`.

### 4) Role memory (`.pi/agent-memory/`)

- Moved `architect/`, `critic/`, `engineer/` directories unchanged to
  `.pi/legacy/agent-memory/`.
- Kept `researcher/`, `reviewer/` (active). Created `executor/`
  with a small role memory recording durable engineering knowledge
  (verified commands and recurring constraints).

### 5) Deep Research material → `.pi/legacy/`

- `.pi/researcher-runtime/` → `.pi/legacy/deep-research/researcher-runtime/`
  (README.md, context-management-extension.ts, package.json,
  package-lock.json, .gitignore). `node_modules/` was excluded per
  copy policy.
- `.pi/research/*.md`, `*.mjs`, `*.json` →
  `.pi/legacy/research/`. `runs/` was excluded.
- `.sidecar/gptr-mcp/` → `.pi/legacy/deep-research/gptr-mcp/`
  (source, tests, docs, config). Excluded: `.git/`, `.venv/`,
  `__pycache__/`.

### 6) Provenance manifest

- Wrote `.pi/legacy/PROVENANCE.md` with path-to-path entries for every
  moved file. Identity is by path, filename, package version, and
  source-of-truth git location. No content hashes are used.

### 7) Project-level docs and artifact roots

- `ADR/0001-minimal-development-loop.md` — decision record.
- `architect.md` (project-level architecture; not a role file).
- `goal.md` — minimal-loop goal statement.
- `project_state.md` — current state of the active surface,
  installed packages, artifact roots, legacy preservation, validation.
- `research/` — preserved `BOOTSTRAP-SELF-001-R2-private-skills.md`.
  `BOOTSTRAP-SELF-001-R1-private-skills.md` was deleted only after
  verifying the exact filename (verified: yes, only that filename).
- `implementation_notes/` (with `.gitkeep`).
- `failures/` (with `.gitkeep`).

### 8) Tests

- Moved the worktree's prior v2.1 tests into `tests/legacy/`:
  `acceptance-v2.1.md`, `agent-communication.test.mjs`,
  `intercom-child.mjs`, `lead-routing-child.mjs`,
  `lifecycle-child.mjs`, `persistent-replay-child.mjs`,
  `real-role-escalation-child.mjs`, `seed-contract.test.mjs`.
- Copied canonical-only test files to `tests/legacy/`:
  `context-management.test.mjs`, `deep-research-mcp-adapter.test.mjs`,
  `gptr-mcp-negative-control.mjs`, `run-deep-research-acceptance.mjs`,
  `synthesize-frozen-acceptance.mjs`,
  `synthesize-frozen-sections.mjs`.
- Created `tests/team-contract.test.mjs` (the deterministic current
  contract test). It asserts:
  - exactly three active agents in `.pi/agents/`
  - exactly three skills with SKILL.md and agents/openai.yaml
  - valid frontmatter on each active role
  - Researcher provider = `../npm/node_modules/pi-web-access/index.ts`
    and no Deep Research tools
  - Executor has the `execute-delegated-task` skill and required tools
  - Reviewer has the `review-delegated-task` skill, bash/edit/write,
    and the production-code prohibition
  - artifact roots exist (`research/`, `implementation_notes/`,
    `failures/`) and R2 is preserved while R1 is gone
  - legacy role material is preserved under `.pi/legacy/` with
    provenance and excluded categories
  - the top-level `tests/` directory contains only the current
    contract test and the legacy directory
- Replaced `tests/run-tests.ps1` to run only
  `tests/team-contract.test.mjs` via `tsx`.

### 9) `.gitignore`

- Added entries for audit (`/audit/`), reply-store
  (`/reply-store/`), runtime (`/researcher-runtime/node_modules/`,
  `/npm/node_modules/`), node_modules at the project root, sidecar
  original copy, traces, and caches.
- Preserved historical evidence under `.pi/legacy/` (no
  gitignore entries for the legacy paths; `PROVENANCE.md` is
  tracked).

## Validation performed

1. **`tests/run-tests.ps1` (via `tsx`):**

   ```
   node .pi/npm/node_modules/tsx/dist/cli.mjs --test tests/team-contract.test.mjs
   ```

   Result: **9 / 9 tests pass** (PASS).

2. **`node --test tests/team-contract.test.mjs`** (direct): PASS.

3. **`git diff --check`:** PASS for all files added or modified by
   this task. Pre-existing trailing-whitespace warnings in
   `.pi/agent-memory/researcher/MEMORY.md`,
   `.pi/research/*.md`, and other tracked files come from prior
   attempts and are out of scope for this task.

4. **`git status`:** confirms the deleted legacy role files,
   the modified `.pi/agents/researcher.md`, the modified
   `.gitignore` and `tests/run-tests.ps1`, and the untracked new
   artifacts under `.pi/legacy/`, `ADR/`, `architect.md`,
   `goal.md`, `project_state.md`, `research/`,
   `implementation_notes/`, `failures/`, `tests/legacy/`, and
   `tests/team-contract.test.mjs`. No files are staged.

5. **Skill `quick_validate.py`** (WSL `python3
   /mnt/c/Users/Hans/.codex/skills/.system/skill-creator/scripts/quick_validate.py`):

   - `.pi/skills/answer-research-question`: **Skill is valid!**
   - `.pi/skills/execute-delegated-task`: **Skill is valid!**
   - `.pi/skills/review-delegated-task`: **Skill is valid!**

## Researcher attempt history

- **`BOOTSTRAP-SELF-001-R1` (failed, deleted):** Verified the exact
  filename `research/BOOTSTRAP-SELF-001-R1-private-skills.md`,
  confirmed it was the untracked incorrect attempt, and deleted it
  per the task contract. R1 reported `ENOENT` for
  `node_modules/@earendil-works/pi-subagents/` because the Researcher
  was looking in the wrong location.
- **`BOOTSTRAP-SELF-001-R2` (preserved):** The successful Researcher
  attempt. It correctly located `pi-subagents` 0.56.0 at
  `.pi/npm/node_modules/pi-subagents/` and cited exact lines in
  `docs/agents.md` and `src/agents/agents.ts`. R2 is preserved at
  `research/BOOTSTRAP-SELF-001-R2-private-skills.md`.
- **This implementation note's existence is itself proof of the
  previous Researcher's status:** the R2 artifact was successful
  but the cutover child status was "failed" because the Researcher
  role at that time did not yet have a local web provider wired in
  (`pi-web-access` was not in `.pi/agents/researcher.md` as a
  `subagentOnlyExtension`). This task wires the provider and
  closes that gap.

## Residual risks

- The worktree has pre-existing modifications to tracked files
  (`.pi/communication/*.mjs`, `.pi/research/*.md`,
  `.pi/researcher-runtime/package*.json`, `.pi/settings.json`,
  `.pi/decisions/*`, `AGENTS.md`, etc.) that are **out of scope**
  for this task. They come from earlier attempts and were not
  reviewed or modified here.
- The `.pi/legacy/` paths intentionally have no `.gitignore`
  entries, so the legacy material is expected to be tracked. If
  the reviewer disagrees with the tracking policy, that is a
  separate decision for Lead.
- The `git diff --check` output shows trailing-whitespace warnings
  on pre-existing modifications; the Reviewer should confirm that
  the new files added by this task contain no whitespace errors.
- The minimal-loop test asserts structural contracts only; it does
  not run an end-to-end live-Provider smoke test. A real-Provider
  smoke is intentionally out of scope and would require a
  `HARNESS_RUN_REAL_ESCALATION=1`-style env gate (no such gate is
  added in this task).

## Stop signal

Executor has stopped. The paired Reviewer may enter the worktree
and run the deterministic contract test plus `git diff --check`
on the new files; they should not edit production code.

## Review Fixes

- **`incorrect-bootstrap-date`** (Reviewer finding, bounded read of
  five specific files): corrected the embedded `Date` field in
  `ADR/0001-minimal-development-loop.md` line 4 from `2026-05-14`
  to `2026-08-24`, and the `**Date:**` field in this implementation
  note from `2026-05-14` to `2026-08-24`. Both dates now match the
  authoritative review date supplied by Lead and the file-creation
  evidence. No other files were modified, no tests were changed,
  nothing was staged or committed.
