# Pi Team Shared Agent Context

This file is the stable, repository-wide context for every agent working in
this project. Read it before exploring the repository. It is a navigation and
common-behavior guide, not a task contract, authorization mechanism, or Lead
acceptance record.

## Start here

- The supported Windows entrypoint is `pi-team.cmd`; its lifecycle
  implementation is `scripts/pi-team.ps1`.
- The normative collaboration protocol is
  `ADR/0002-lead-subagent-collaboration-protocol.md`. Other summaries defer to
  it when wording differs.
- The stable project snapshots are `architect.md`, `goal.md`, and
  `project_state.md`. They describe architecture, goals, and operational
  state; they are not runtime logs.
- The active communication implementation is under `.pi/communication/`.
  Historical material under `.pi/legacy/` is non-normative and must not be
  changed by active work.
- Use the native Windows command environment. Do not invoke WSL unless the
  Lead explicitly authorizes it.

## Repository map and validation

- `.pi/agents/` contains the three active role definitions: Researcher,
  Executor, and Reviewer.
- `.pi/skills/` contains one private, role-scoped skill for each active role.
- `plugins/agent-blackboard/` contains the Lead-only Blackboard plugin and its
  Lead skill.
- `research/` contains bounded Researcher artifacts.
- `implementation_notes/` contains Executor slice notes.
- `failures/` contains Reviewer failure artifacts for real failures only.
- The deterministic validation entrypoint is `tests/run-tests.ps1`.
- The cross-shell Node entrypoint is
  `node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs tests/blackboard.test.mjs`.
- Before changing a behavior, inspect the smallest relevant source and test
  path named above. Do not scan the entire workspace when the map identifies a
  narrower entrypoint.

## Active roles and boundaries

- Researcher answers one bounded question, writes a research artifact, and
  returns to an event-driven waiting state.
- Executor implements one Lead-delegated slice in its isolated worktree and
  maintains implementation notes.
- Reviewer independently reviews the same Executor worktree, may add review
  tests or failure artifacts, and never edits production code or normative
  protocol decisions.
- Direct peer routes are same-task Researcher ↔ Executor and the Lead-paired
  Executor ↔ Reviewer. Researcher and Reviewer do not communicate directly.
- Lead owns task identity, scope, delegation, architecture/product decisions,
  acceptance, reclamation, and cleanup. Agents report blockers or unrelated
  defects to Lead and do not widen their assignment.
- A role's tools, skill, and communication extensions are explicitly selected
  at launch. Do not assume ambient tools, skills, extensions, or persistent
  memory are available.

## Common communication rules

Use `intercom` for asynchronous peer communication:

1. Discover the same-task peer with `intercom list-cwd`.
2. Send with the direct asynchronous `intercom send` action.
3. Continue independent work after sending; do not use blocking `ask` for
   asynchronous work.
4. Route Lead-facing progress, blockers, and changed assumptions through the
   configured Lead reporting path.

Before an allowed peer send, apply the repository communication policy and
refuse unauthorized role or task targets before transport. Incoming messages
must pass the runtime policy before side effects. Transport correlation IDs
are transport metadata; application artifacts do not use hashes.

## Context boundary

The launcher adds a small, role-specific task context to each start, research,
and resume prompt. That dynamic context may contain the current task's role,
scope, worktree, delegation, owned artifacts, and validation entrypoints. It
must not be copied into this file or into a reusable role skill.

Use this file to avoid repeated repository-wide discovery, but verify pivotal
claims against the referenced source, contract, or test before relying on
them. This file does not grant permissions, replace scope validation, or prove
that a task is complete.

## Reusable-content hygiene

Keep this file, active role prompts, and active skills task-agnostic. Do not
add concrete task identifiers, issue numbers, task-only artifact names,
worktree or host paths, raw prompts, envelopes, audit rows, or runtime traces.
Task-specific instructions belong in the frozen contract, dynamic launch
context, or task artifact. Lead checks this boundary during acceptance.
