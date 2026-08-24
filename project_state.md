# Project State (as of BOOTSTRAP-SELF-003 cutover)

## Active agent surface

Exactly three active agents are loaded by `pi-subagents` from
`.pi/agents/`. Each active role is defined by its role prompt plus one
private skill under `.pi/skills/`; **no active role binds persistent
role memory** (no `memory:` frontmatter, no active `.pi/agent-memory/{role}/MEMORY.md`).

| Agent | Skill | Provider | Memory |
| --- | --- | --- | --- |
| `researcher` | `answer-research-question` | `.pi/npm/node_modules/pi-web-access/index.ts` (via `subagentOnlyExtensions`) | none (prompt + private skill only) |
| `executor` | `execute-delegated-task` | n/a | none (prompt + private skill only) |
| `reviewer` | `review-delegated-task` | n/a | none (prompt + private skill only) |

The legacy role files for `architect`, `critic`, and `engineer`
are present in `.pi/legacy/agents/` but are not loaded.

## Installed packages

`.pi/settings.json` declares the three installed npm packages:

- `npm:pi-intercom` (peer transport)
- `npm:pi-subagents` (agent loader)
- `npm:pi-web-access` 0.24.2 (web-access provider; resolved to
  `.pi/npm/node_modules/pi-web-access/index.ts`)

The Deep Research MCP runtime under `.pi/researcher-runtime/` and
its installed dependencies (`@modelcontextprotocol/sdk` 1.30.0,
`playwright` ^1.62.1) are preserved in
`.pi/legacy/deep-research/researcher-runtime/`. The Deep Research
MCP tools are **not** wired to the active Researcher.

## Artifact roots (project root)

- `research/` — Researcher artifacts. Default name pattern
  `<task-id>-<slug>.md`; the slug is a short kebab-case topic label.
- `implementation_notes/` — Executor notes per task. Required
  filename pattern `<task-id>.md`; required stop signal.
- `failures/` — Reviewer failure artifacts. Default name pattern
  `<task-id>-<finding-id>.md`; reserved for real failures only.

## Legacy preservation

- `.pi/legacy/agents/` — `architect.md`, `critic.md`, `engineer.md`
  (unchanged).
- `.pi/legacy/communication/extensions/` — `architect.ts`,
  `critic.ts`, `engineer.ts` (unchanged).
- `.pi/legacy/communication/audit/` — role-specific audit JSONL
  files.
- `.pi/legacy/communication/reply-store/` — role-specific replay
  store JSON.
- `.pi/legacy/agent-memory/` — role-specific memory for the three
  deprecated roles, plus the archived historical memories of the
  previous active Researcher (Deep Research lineage,
  `.pi/legacy/agent-memory/researcher-deep-research/MEMORY.md`) and
  Reviewer (`.pi/legacy/agent-memory/reviewer/MEMORY.md`). The active
  roles themselves no longer bind persistent role memory.
- `.pi/legacy/deep-research/researcher-runtime/` — Deep Research
  runtime source/tests/docs/config (no `node_modules`).
- `.pi/legacy/deep-research/gptr-mcp/` — `gptr-mcp` sidecar
  source/tests/docs/config (no `.venv`, no `__pycache__`, no
  `.git`).
- `.pi/legacy/research/` — Deep Research notes, architecture docs,
  and adapter source (`runs/` excluded).
- `.pi/legacy/PROVENANCE.md` — path-to-path provenance manifest,
  no content hashes.

The canonical repository `D:\Coding\Harness\Pi-team` is unchanged.

## Validation

- `tests/run-tests.ps1` runs only `tests/team-contract.test.mjs`
  (the deterministic team-contract test).
- `node --test tests/team-contract.test.mjs` is the direct
  command-line entry point for the same test.
- `git diff --check` must pass with no whitespace or conflict
  markers.
- `git status` must show the new artifacts and moved files; no
  commits or staging are performed.
- Skill frontmatter is validated by `quick_validate.py` for all
  three skills.

## Out of scope (current task)

- Refactoring the shared intercom implementation under
  `.pi/communication/`.
- Production deployment or runtime orchestration outside the
  routine development loop.
- Replacing or modifying the canonical repository.
