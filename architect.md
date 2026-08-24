# Minimal Development Loop — High-level Architecture

This document is the project-level architecture for the routine
development path after ADR 0001. It is **not** the agent role file
(`.pi/agents/architect.md`); the active agent surface is
`.pi/agents/{researcher.md, executor.md, reviewer.md}`.

## Roles and responsibilities (active path)

Three active roles plus the Lead form the minimal loop:

| Role | Surface | Skill | Artifact root |
| --- | --- | --- | --- |
| Lead (Codex) | user-facing session | n/a | decisions under `.pi/decisions/`, project-level docs at repo root |
| Researcher | `.pi/agents/researcher.md` | `answer-research-question` | `research/<task-id>-<slug>.md` |
| Executor | `.pi/agents/executor.md` | `execute-delegated-task` | `implementation_notes/<task-id>.md` |
| Reviewer | `.pi/agents/reviewer.md` | `review-delegated-task` | `failures/<task-id>-<finding-id>.md` |

## Researcher provider and tool surface

The bounded Researcher is wired to the installed local web-access
provider at `.pi/npm/node_modules/pi-web-access/index.ts`
(via `subagentOnlyExtensions`). The Researcher exposes only:

- `web_search`
- `fetch_content`
- `get_search_content`
- `source_check`

The Deep Research MCP tools (`research_run`,
`deep_research_task`, `deep_research_review`,
`research_synthesis_input`, `research_report_artifact`) are
**not** exposed to the active Researcher. Multi-question research
must be decomposed into sequential Researcher questions or escalated
to Lead via `contact_supervisor` with `reason: "need_decision"`.

## Executor scope

The Executor operates inside an isolated worktree assigned by Lead and
emits a stop signal in `implementation_notes/<task-id>.md` before
returning. Executor does **not** refactor unrelated code, edit tests
to hide failures, or commit without Lead authorization.

## Reviewer scope

The Reviewer enters the paired worktree only after Executor has
stopped. Reviewer edits tests and writes failure artifacts only; it
**never** edits production code.

## Communication

- The shared intercom implementation under `.pi/communication/`
  remains active and unchanged.
- The Researcher role's runtime policy extension is
  `.pi/communication/extensions/researcher.ts`.
- The Reviewer role's runtime policy extension is
  `.pi/communication/extensions/reviewer.ts`.
- The Executor is paired with the Researcher and the Reviewer.
- All agents route routine completions to Lead via
  `pi-subagents` and escalate with `contact_supervisor` using the
  closed reason enum.

## Legacy

The legacy five-agent material and the Deep Research substrate are
preserved under `.pi/legacy/`. See `.pi/legacy/PROVENANCE.md` for the
path-to-path provenance manifest. The canonical repository
(`D:\Coding\Harness\Pi-team`) is unchanged.
