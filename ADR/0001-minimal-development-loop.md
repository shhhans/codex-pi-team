# ADR 0001 — Minimal Development Loop

Status: Accepted
Date: 2026-08-24
Supersedes: implicit v2.1 architecture for active development paths
Lead task: BOOTSTRAP-SELF-002

Lifecycle note: ADR 0002 supersedes this ADR's stop-signal and
Reviewer-entry wording. ADR 0001 remains authoritative for role topology,
artifact roots, and legacy preservation only.

## Context

The project previously carried an embedded five-agent architecture
(researcher, architect, critic, engineer, reviewer) and an integrated Deep
Research MCP substrate (`research_run`, `deep_research_task`,
`deep_research_review`, `research_synthesis_input`,
`research_report_artifact`). Operational evidence showed that the
Deep Research path is not reliably available inside the assigned harness
worktrees and that the five-agent topology complicates the routine
implementation, review, and reproduction path.

A bounded, role-specific Researcher attempt (`BOOTSTRAP-SELF-001-R2`)
confirmed that the web-access provider (`pi-web-access` 0.24.2) is the
installed local source for `web_search`, `fetch_content`,
`get_search_content`, and `source_check`. The Deep Research MCP tool
surface is not exposed by the harness in the routine path.

## Decision

Adopt a minimal three-agent development loop for the routine path:

- Researcher (bounded, single-question, web + local lookup)
- Executor (single-worktree implementation and notes)
- Reviewer (paired review, tests + failure artifacts only)

Move the legacy five-agent material (architect, critic, engineer role
files and their role-specific extensions, audit logs, reply stores, and
role memories) into `.pi/legacy/` unchanged so that historical evidence
and decision provenance remain intact. Move the Deep Research runtime
(`.pi/researcher-runtime`) and the Deep Research material under
`.pi/research/` into `.pi/legacy/deep-research/` and `.pi/legacy/research/`
respectively. Move the `gptr-mcp` sidecar source into
`.pi/legacy/deep-research/gptr-mcp/`.

Wire the bounded Researcher to the installed web-access provider at
`.pi/npm/node_modules/pi-web-access/index.ts` via
`subagentOnlyExtensions`, and continue to expose only `web_search`,
`fetch_content`, `get_search_content`, and `source_check` from that
provider. Do **not** expose `research_run`, `deep_research_task`,
`deep_research_review`, `research_synthesis_input`, or
`research_report_artifact` to the active Researcher.

## Consequences

Positive:

- The Researcher role has a concrete installed provider and a
  deterministic test surface for the routine path.
- Executor and Reviewer roles are scoped to one worktree and one task
  ID, which removes cross-worktree scope creep.
- Legacy material is preserved and traceable; nothing is silently
  deleted.

Negative / accepted tradeoffs:

- The Deep Research MCP path is no longer reachable from the active
  Researcher; multi-question research must be decomposed into
  sequential Researcher questions and re-delegated.
- The five-agent peer policy is no longer in effect for the routine
  path; the only active direct peer channels are Researcher ↔ Executor
  (paired) and Executor ↔ Reviewer (paired), plus the universal
  `contact_supervisor` route to the Lead.

## Required artifact roots

- `research/<task-id>-<slug>.md` — Researcher artifacts.
- `implementation_notes/<task-id>.md` — Executor notes and slice state.
- `failures/<task-id>-<finding-id>.md` — Reviewer failure artifacts.

No content hashes are used; IDs come from Lead.

Transport correlation UUIDs are an internal intercom detail and are
not application artifact IDs. Direct role topology is limited to
Researcher <-> Executor <-> Reviewer; Lead assigns the concrete pairing.

## Validation

- `tests/run-tests.ps1` runs the team-contract and communication-policy
  tests.
- The team-contract test asserts: exactly three active agents
  (researcher, executor, reviewer); explicit skills; Researcher
  provider/no Deep Research tools; exact root artifact contracts;
  Reviewer production-code prohibition; legacy preservation.
- Skill frontmatter is validated by `quick_validate.py` for all three
  skills (`answer-research-question`, `execute-delegated-task`,
  `review-delegated-task`).

## Operational evidence boundary

Policy unit tests and extension loading do not by themselves establish
causal transport capability. The first live smoke established peer
discovery and Executor-to-Reviewer socket delivery, but did not inject
the message into the Reviewer's already-running non-interactive turn.
Bidirectional direct communication remains operationally unproven until
persistent interactive sessions exercise an injected event at a turn
boundary without stop/resume.

Production deployment remains out of scope.
