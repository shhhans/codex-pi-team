# Project State (as of BOOTSTRAP-SELF-007 protocol alignment)

The stable entrypoint implementation is present at `pi-team.cmd` with its
PowerShell lifecycle under `scripts/pi-team.ps1`. The runtime uses the Git
common directory `pi-team/v1` state root and direct role sessions.
The launcher injects `PI_TEAM_TASK_ID`, `PI_TEAM_ROLE`, `PI_TEAM_AGENT_ID`,
`PI_TEAM_WORKTREE`, `PI_TEAM_STATE_ROOT`, and `PI_TEAM_SCOPE_ID` for every
role process; `PI_TEAM_STATE_ROOT` resolves to `<git-common-dir>/pi-team/v1`.
Do not append state paths to a worktree's `.git`, because that entry may be a
pointer file.

`ADR/0002-lead-subagent-collaboration-protocol.md` is the sole normative
Lead–Subagent collaboration protocol. Active summaries defer to it.

## Active agent surface

Exactly three active agents are loaded by `pi-subagents` from
`.pi/agents/`. Each active role is defined by its role prompt plus one
private skill under `.pi/skills/`; **no active role binds persistent
role memory** (no `memory:` frontmatter, no active `.pi/agent-memory/{role}/MEMORY.md`).

| Agent | Skill | Provider | Memory |
| --- | --- | --- | --- |
| `researcher` | `answer-research-question` | `~/.pi/agent/npm/node_modules/pi-web-access/index.ts` (via `subagentOnlyExtensions`) | none (prompt + private skill only) |
| `executor` | `execute-delegated-task` | n/a | none (prompt + private skill only) |
| `reviewer` | `review-delegated-task` | n/a | none (prompt + private skill only) |

All three roles also load their matching communication-policy extension.
Researcher additionally loads `pi-web-access`.

The legacy role files for `architect`, `critic`, and `engineer`
are present in `.pi/legacy/agents/` but are not loaded.

## Installed packages

`.pi/settings.json` declares no npm packages. Run `pi-team setup` once to
install these pinned packages in Pi's user package directory:

- `npm:pi-intercom@0.11.0` (peer transport)
- `npm:pi-subagents@0.56.0` (agent loader)
- `npm:pi-web-access@0.24.2` (Researcher-only web-access provider)

All roles disable ambient extensions. Shared intercom is loaded explicitly by
each role, while only Researcher loads Web Access. `doctor` checks this state
without modifying it; role-launching commands fail fast if setup is incomplete.

The Deep Research MCP runtime under `.pi/researcher-runtime/` and
its installed dependencies (`@modelcontextprotocol/sdk` 1.30.0,
`playwright` ^1.62.1) are preserved in
`.pi/legacy/deep-research/researcher-runtime/`. The Deep Research
MCP tools are **not** wired to the active Researcher.

## Artifact roots (project root)

- `research/` — Researcher artifacts. Default name pattern
  `<task-id>-<slug>.md`; the slug is a short kebab-case topic label.
- `implementation_notes/` — Executor notes per task. Required
  filename pattern `<task-id>.md`; records the current slice state,
  validation evidence, changed files, and remaining risks.
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
- Executor and Reviewer are persistent for the task. They remain alive
  through review/fix and finish each turn by reporting the completed
  slice and becoming idle/event-driven. Only Lead acceptance permits
  reclamation.
- Denied inbound messages are filtered before model context and cause
  no reply-store access. Allowed inbound messages are retained.
- The four BOOTSTRAP-SELF-004A Reviewer findings are resolved.
- BOOTSTRAP-SELF-006 resolved the Windows CRLF frontmatter-test defect;
  both deterministic test files now accept LF and CRLF delimiters.

## Validation

- `tests/run-tests.ps1` runs both deterministic test files.
- `node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs`
  is the cross-shell entry point.
- Current result: 31/31 tests pass; `git diff --check` passes.
- Skill frontmatter is validated by `quick_validate.py` for all
  three skills.

## Operational limitation

The supported collaboration contract does not authorize Agents to add a
Scout, repeat unbounded discovery, or decompose unassigned subtasks.
Windows tasks use the native command environment; WSL requires explicit
Lead authorization.

The earlier live intercom smoke established session discovery and an
Executor-to-Reviewer `socket_delivered` acknowledgement, but not causal
message use. The required operational shape is now persistent interactive
Executor/Reviewer sessions: slice completion reports to Lead, an injected
peer event starts the next turn, and the receiver returns to idle without
stop/resume. This remains to be proven end to end.

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

- Provide and verify a stable Pi role-session entry separately from this
  protocol task.
- Prove one complete persistent Executor/Reviewer review/fix exchange with
  causal message use and Lead acceptance before claiming the live loop.
