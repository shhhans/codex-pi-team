# Minimal Development Loop — High-level Architecture

This document is the project-level architecture for the routine
development path after
`ADR/0002-lead-subagent-collaboration-protocol.md`, the sole normative
collaboration protocol. It is **not** the agent role file
(`.pi/agents/architect.md`); the active agent surface is
`.pi/agents/{researcher.md, executor.md, reviewer.md}`.

## Roles and responsibilities (active path)

Three active roles plus the Lead form the minimal loop:

| Role | Surface | Skill | Artifact root |
| --- | --- | --- | --- |
| Lead (Codex) | user-facing session | n/a | `ADR/`, `architect.md`, `goal.md`, `project_state.md` |
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

The Executor operates inside an isolated worktree assigned by Lead,
maintains `implementation_notes/<task-id>.md`, and remains allocated
through the complete review/fix cycle. At a slice boundary it reports
`READY_FOR_REVIEW`, `FIX_READY`, or `READY_FOR_ACCEPTANCE` and becomes
idle; it does not stop. Executor does **not** refactor unrelated code,
edit tests to hide failures, or commit without Lead authorization.

## Reviewer scope

The Reviewer is allocated with its paired Executor, registers the task,
and waits idle until `READY_FOR_REVIEW` or `FIX_READY`. Reviewer edits
tests and writes failure artifacts only; it **never** edits production
code or normative documentation. Read-only Git operations are available
for review.

## Communication

- Each active role loads its matching runtime-policy extension under
  `.pi/communication/extensions/{researcher,executor,reviewer}.ts`.
- Direct peer exchange is asynchronous and limited to
  `Researcher <-> Executor <-> Reviewer`. Researcher and Reviewer
  cannot address each other directly.
- Executor and Reviewer pairing is assigned by Lead. The role-level
  ACL proves only the allowed role pair, not same-task identity.
- The pair persists through review/fix cycles. Each completed slice is
  reported to Lead before the role returns to an event-driven idle state;
  only Lead acceptance triggers reclamation.
- Routine peer results can travel directly. Material risk, a changed
  downstream assumption, or a decision request is mirrored to Lead
  with `contact_supervisor` using `need_decision`, `progress_update`,
  or `interview_request`.
- Runtime-policy tests prove policy behavior and extension wiring.
  They do not, by themselves, prove causal use of the transport.
- Agents do not create Scout roles, repeat unbounded discovery, or split
  unassigned subtasks. Lead supplies and controls the task contract.

## Agent Blackboard

The repo-local `plugins/agent-blackboard/` is the Lead's observability
surface. Its MCP tools manage Lead-owned task metadata and watch append-only
Agent events stored at `<git-common-dir>/harness-blackboard/v1/`. The active Pi
roles load `.pi/communication/extensions/blackboard-update.ts`; runtime
identity, sequence, worktree, and observation time are not agent-controlled.
The Blackboard displays current task objective and activity but does not
authorize work, prove completion, or replace Lead inspection and acceptance.
The read-only `pi-team.cmd inspect` command gathers contract, diff, artifact,
test, process, issue, and Blackboard evidence. The `pi-team.cmd finalize`
command executes the Lead's accepted decision; Blackboard projection lag is
returned as a warning rather than a close gate.
The UI requests PiP when available and otherwise renders inline.

## Legacy

The legacy five-agent material and the Deep Research substrate are
preserved under `.pi/legacy/`. See `.pi/legacy/PROVENANCE.md` for the
path-to-path provenance manifest. The canonical repository
(`D:\Coding\Harness\Pi-team`) is unchanged.
