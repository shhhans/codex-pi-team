# ADR 0002 — Lead–Subagent Collaboration Protocol

Status: Accepted
Date: 2026-08-24
Supersedes: the lifecycle and handoff rules in ADR 0001
Lead task: BOOTSTRAP-SELF-007

## Context

ADR 0001 established the active Lead, Researcher, Executor, and Reviewer
roles, but it treated an Executor stop as the handoff to Reviewer. That
lifecycle is incompatible with the required review/fix loop: the paired
Executor and Reviewer must retain task context until Lead accepts the work.
The active files also contained a stale Architect/Critic topology and did
not identify one normative collaboration protocol.

## Decision

This ADR is the sole normative Lead–Subagent collaboration protocol. Other
active documents summarize it and must defer to it when wording conflicts.
Historical files under `.pi/legacy/` remain non-normative and unchanged.

### Authority

Lead (Codex) is the only task authority and the only role that communicates
with the User. Lead owns:

- task ID, task name, task description, scope, constraints, and done criteria;
- role selection, Researcher assignment, Executor/Reviewer pairing, and the
  isolated worktree;
- acceptance, rejection, follow-up direction, and resource reclamation;
- `goal.md`, `project_state.md`, and alignment of `architect.md`.

Architecture and product decisions belong to Lead and User. Accepted
decisions are recorded in `ADR/` and reflected in `architect.md`; a
Subagent may provide evidence or alternatives but must not decide them.

A task contract needs only the information required to avoid ambiguity:
task ID, name, objective, in-scope boundary, done criteria, worktree (for
development tasks), pairing, and material constraints. A Subagent may not
rewrite the contract, create a Scout, split off an unassigned task, or widen
scope. It asks Lead when one of these fields is missing or contradictory.

### Roles and artifact ownership

- Researcher answers one specific question and maintains `research/`.
- Executor implements one Lead-delegated task in the assigned worktree and
  maintains `implementation_notes/` plus the task's implementation files.
- Reviewer is paired one-to-one with an Executor, reviews the same worktree,
  writes or edits tests, and maintains `failures/`. Reviewer never edits
  production or normative documentation.

Executor does not edit tests to conceal failures. Reviewer may use read-only
Git operations (`status`, `diff`, `log`, `show`, `blame`, and equivalent)
because they are necessary for review. Commit, stash, reset, checkout,
rebase, destructive cleanup, and other worktree-changing Git operations
require explicit Lead authorization.

### Persistent pair lifecycle

Lead allocates the Executor and Reviewer as a persistent pair for the task.
Both sessions remain alive through implementation, review, fixes, and
re-review. Completing a turn means reporting the current result and becoming
idle/event-driven; it does not mean stopping the process or surrendering the
task. Normal coordination must not use stop/resume.

The lifecycle is:

1. Lead assigns the task and pair.
2. Reviewer registers the task and becomes idle while Executor implements.
3. Executor validates, updates `implementation_notes/<task-id>.md`, sends
   `READY_FOR_REVIEW`, reports the completed slice to Lead, and becomes idle.
4. Reviewer reviews and sends either `REVIEW_PASS` or `REVIEW_FAIL`. It
   reports the completed review slice to Lead and becomes idle.
5. On failure, Executor fixes production/documentation, sends `FIX_READY`,
   and the same Reviewer re-reviews. The pair repeats without stop/resume.
6. After a pass, Executor reports `READY_FOR_ACCEPTANCE`. Lead independently
   verifies the done criteria and either requests another slice or accepts.
7. Only after Lead acceptance may Lead reclaim both sessions and clean up the
   worktree according to the worktree policy.

An idle session waits for an injected event; it does not poll indefinitely.
Every slice-ending report includes the Lead task ID, state/event name,
artifact paths, validation evidence, and any blocker or remaining risk.
Completion must be visible to Lead through the runtime's native completion
channel or a non-blocking `progress_update`; it is never implemented as an
unbounded wait.

### Communication

Allowed direct peer routes are `Researcher <-> Executor` for the same task
and the paired `Executor <-> Reviewer`. Researcher and Reviewer do not
communicate directly. Peer messages are asynchronous `send` events, not
blocking `ask` calls. The receiver handles each injected message as a new
turn and returns to idle after reporting its result.

Routine implementation/review details travel directly within the pair.
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

Lead accepts only after inspecting the diff, validation evidence, Reviewer
verdict, unresolved risks, and the task's done criteria. A tool call, audit
record, or socket-delivery acknowledgement alone does not prove that an
Agent used a message or that the collaboration loop works causally.

## Consequences

The pair retains context across review/fix cycles and can communicate
directly without making Lead a message relay. Lead remains responsible for
direction and acceptance. Persistent sessions consume resources until Lead
reclaims them, so agents must finish turns in an idle, event-driven state.
