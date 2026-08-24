# Project State (as of BOOTSTRAP-SELF-004A review pass)

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

All three roles also load their matching communication-policy extension.
Researcher additionally loads `pi-web-access`.

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

## Communication state

- Active topology: `Researcher <-> Executor <-> Reviewer`.
- Researcher and Reviewer are directly denied in both directions.
- Lead assigns the concrete Executor/Reviewer pairing; current policy
  enforces role topology, not a task-scoped pair identifier.
- Denied inbound messages are filtered before model context and cause
  no reply-store access. Allowed inbound messages are retained.
- The four BOOTSTRAP-SELF-004A Reviewer findings are resolved.
- BOOTSTRAP-SELF-006 resolved the Windows CRLF frontmatter-test defect;
  both deterministic test files now accept LF and CRLF delimiters.

## Validation

- `tests/run-tests.ps1` runs both deterministic test files.
- `node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs`
  is the cross-shell entry point.
- Current result: 25/25 tests pass; `git diff --check` passes.
- Skill frontmatter is validated by `quick_validate.py` for all
  three skills.

## Operational limitation

`pi-subagents runs.run` has expanded narrow review briefs into extra
reconnaissance, and Pi child shells cannot execute Windows PowerShell
binaries from WSL. Directly loading the role prompt, private skill, and
role extension produced the bounded Reviewer PASS.

The live intercom smoke established session discovery and an
Executor-to-Reviewer `socket_delivered` transport acknowledgement. The
message was not injected into the Reviewer's active non-interactive
turn, so Reviewer did not send an acknowledgement and Executor correctly
reported `NOT SUCCESS`. Bidirectional direct communication is therefore
configured and unit-tested but not yet operationally proven end to end.
Unit tests and socket delivery alone are not a causal capability claim.

## Completed bootstrap evidence

- Bounded Researcher smoke passed: BOOTSTRAP-SELF-005 answered one
  official-documentation question with ordinary web-access tools and
  wrote `research/BOOTSTRAP-SELF-005-node-test-exit-code.md`. Direct
  content fetch was blocked by the provider's SSRF/TUN guard, so the
  artifact records that its official-source evidence came through
  search snippets and `source_check`.
- The reviewed communication cutover is merged on `master`; canonical
  untracked legacy material was preserved under `.pi/legacy/` and the
  canonical worktree was cleaned.

## Remaining bootstrap work

- Determine and test the required turn-boundary/resume behavior for a
  live paired Executor/Reviewer intercom exchange without concurrent
  editing.
