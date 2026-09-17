# ADR 0002 — Lead–Subagent Collaboration Protocol

Status: Accepted
Date: 2026-08-24
Supersedes: the lifecycle and handoff rules in ADR 0001; the Reviewer workflow
Lead task: BOOTSTRAP-SELF-007

## Context

ADR 0001 established the active Lead, Researcher, Executor, and Reviewer
roles. Modular Collaboration v1 replaces the active Reviewer workflow with a
Validator: the Validator writes independent black-box tests from a frozen
contract and must not inspect the target implementation. Historical Reviewer
material remains under `.pi/legacy/`. The active pair must retain task context
until Lead accepts the work.

## Decision

This ADR is the sole normative Lead–Subagent collaboration protocol. Other
active documents summarize it and must defer to it when wording conflicts.
Historical files under `.pi/legacy/` remain non-normative and unchanged.

### Authority

Lead (Codex) is the only task authority and the only role that communicates
with the User. Lead owns:

- task ID, task name, objective, acceptance decision, and task lifecycle;
- role selection, Researcher assignment, Executor/Validator pairing, and the
  isolated worktree;
- acceptance, rejection, follow-up direction, and resource reclamation;
- `goal.md`, `project_state.md`, and alignment of `architect.md`.

Architecture and product decisions belong to Lead and User. Accepted
decisions are recorded in `ADR/` and reflected in `architect.md`; a
Subagent may provide evidence or alternatives but must not decide them.

A v3 task contract contains only the information required to avoid ambiguity:
task ID, name, objective, optional explanatory context, observable acceptance
results, base ref, branch, and worktree. It may also name optional deliverable
types. It does not encode file scope, role delegation, capability, ownership,
or artifact mappings. Lead uses `inspect` to decide whether actual changes are
out of scope. A Subagent may not rewrite the contract, create a Scout, split
off an unassigned task, or widen the objective.

### Task boundaries, issue tracking, and branch isolation

`develop` is the stable integration baseline. Every development task uses one
focused branch and one worktree created from the contract's explicit,
validated, clean `base_ref`; the launcher must not infer the base from the
directory in which it is invoked. Until the launcher enforces `base_ref`, Lead
must pre-create and verify the task branch from that ref, or stop before
launching agents. A task branch is not a substitute for an issue record, and a
worktree is not a second integration baseline.

An Agent reports a newly discovered defect or unrelated improvement to Lead;
it does not widen the current contract, create a local issue ledger, or change
the main worktree. Once a configured remote repository and Issue permissions
have been verified, Lead records the defect in GitHub Issues with a concise,
sanitized summary and reproducible evidence. If that repository or permission
is unavailable, Lead reports the blocker to the User rather than inventing a
GitHub target or silently falling back to untracked local issue files.

Code work for an issue is a new Lead-owned task, normally using a branch named
`fix/issue-<number>-<slug>` and a separate worktree from the selected clean
base. The task, branch, worktree, pull request, and Issue remain linked; the
fix is reviewed and verified independently before merge and Issue closure.
If it overlaps the active task, Lead records the dependency and chooses the
merge order explicitly. Raw prompts, envelopes, audit logs, host paths, and
runtime reports stay outside Git or in an explicitly designated archive;
GitHub Issues contain only the sanitized summary and evidence needed for
coordination.

### Roles and artifact ownership

- Researcher answers one specific question and maintains `research/`.
- Executor implements one Lead-delegated task in the assigned worktree and
  maintains `implementation_notes/` plus the task's implementation files.
- Validator is paired one-to-one with an Executor, writes independent black-box
  tests from the frozen contract, and maintains `failures/`. Validator never
  reads the target implementation or edits production or normative documentation.

Executor does not edit tests to conceal failures. Validator may read public
interfaces, the frozen contract, test specifications, and its own tests, but
does not inspect source through Git, search, or another indirect route.

### Persistent pair lifecycle

Lead allocates the Executor and Validator as a persistent pair for the task.
Both sessions remain alive through contract negotiation, implementation,
validation, fixes, and re-validation. Completing a turn means reporting the
current result and becoming idle/event-driven; it does not mean stopping the
process or surrendering the task. Normal coordination must not use stop/resume.

The lifecycle is:

1. Lead assigns the task and pair. Executor submits the structured contract;
   Validator comments and both ACK the same complete body. The contract then freezes.
2. Validator writes independent tests from that contract and becomes idle while
   Executor implements.
3. Executor updates `implementation_notes/<task-id>.md`, sends
   `READY_FOR_VALIDATION`, reports the completed slice to Lead, and becomes idle.
4. Validator runs its tests and sends either `VALIDATION_PASS` or
   `VALIDATION_FAIL`, with evidence or failure paths and contract basis.
5. On failure, Executor fixes production code, sends `FIX_READY`, and the same
   Validator re-tests without inspecting source. The pair repeats without stop/resume.
6. After a pass, Executor reports `READY_FOR_ACCEPTANCE`. Lead runs
   `pi-team.cmd inspect <task-id>`, independently verifies the objective and
   acceptance results, and either requests another slice or accepts.
7. After Lead acceptance, Lead invokes `pi-team.cmd finalize <task-id>`.
   Finalize reclaims task-owned sessions and cleans up the worktree according
   to the worktree policy. Blackboard projection lag is reported to Lead but
   does not revoke an accepted decision.

After acceptance, Lead synchronizes the project documentation before treating
the task as fully documented: update `architect.md` only when architecture
changes, update `goal.md` only when goals or done criteria change, update
`project_state.md` after material launcher, lifecycle, integration,
repository-workflow, or closure changes, and update `README.md` when the
operator-facing workflow changes. This is a Lead-owned checkpoint, not an
Agent's substitute for acceptance; Lead checks the resulting diff, tests, and
acceptance evidence together.

An idle session waits for an injected event; it does not poll indefinitely.
Every slice-ending report includes the Lead task ID, state/event name,
artifact paths, validation evidence, and any blocker or remaining risk.
Completion must be visible to Lead through the runtime's native completion
channel or a non-blocking `progress_update`; it is never implemented as an
unbounded wait.

### Communication

Allowed direct peer routes are `Researcher <-> Executor` for the same task
and the paired `Executor <-> Validator`. Researcher and Validator do not
communicate directly. Contract negotiation is recorded through contract tools,
not peer messages. Peer messages are asynchronous `send` events, not
blocking `ask` calls. The receiver handles each injected message as a new
turn and returns to idle after reporting its result.

Routine implementation/validation details travel directly within the pair.
Blocked scope, architecture/product questions, contract contradictions,
material risk, and changed assumptions go to Lead. Direct peer policy is an
Agent rule enforced and audited by Lead; it is not claimed as a transport
ACL.

### Execution boundaries

- Use the native command environment of the assigned worktree. On Windows,
  do not invoke WSL unless Lead explicitly authorizes it.
- Necessary discovery is bounded by the assigned task. Repeated discovery,
  an extra Scout, and new subtask decomposition require Lead direction.
- Treat LF and CRLF as valid repository line endings where parsers permit.
  Do not use stash/reset/checkout as an automatic line-ending remedy.
- Human-readable task IDs come from Lead. Application artifacts do not use
  hashes; transport correlation identifiers remain transport-only.
- `.pi/legacy/` is historical evidence and is never changed by active tasks.

## Acceptance and evidence

Lead accepts only after inspecting the diff, validation evidence, Validator
verdict, unresolved risks, and the task's done criteria. A tool call, audit
record, or socket-delivery acknowledgement alone does not prove that an
Agent used a message or that the collaboration loop works causally.
When a task changes repository workflow or operational state, Lead also checks
the documentation-alignment checkpoint above before acceptance is finalized.

## Consequences

The pair retains context across review/fix cycles and can communicate
directly without making Lead a message relay. Lead remains responsible for
direction and acceptance. Persistent sessions consume resources until Lead
reclaims them, so agents must finish turns in an idle, event-driven state.
Cleaning up a completed task removes its clean worktree; deleting its branch
is a separate Lead action and is allowed only after the branch is merged or
explicitly archived and no worktree still references it.
