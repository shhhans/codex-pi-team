# ADR 0006 — Lead decision, inspection, and deterministic finalization

Status: Accepted
Date: 2026-09-09

## Context

Pi Team has a flexible Lead that must be able to evaluate evidence and make a
delivery decision. A lifecycle command must not repeat that decision based on
lagging Blackboard projections or stale runtime observations.

## Decision

`inspect <task-id>` is a read-only evidence collector. It reports the v3
contract, worktree, branch, actual changes, artifacts, tests, process
ownership, reusable-content hygiene, GitHub issue state, and Blackboard
observations. It does not decide whether an actual change is out of scope,
accept a task, change task state, or infer that the task is complete.
Blackboard non-convergence is a warning.

`accept <task-id>` records the Lead's decision after reviewing available
Reviewer evidence and an independent Lead inspection. If a Reviewer projection
is stale or unavailable, the Lead may accept after recording that warning in
task state. `finalize <task-id>` executes that decision: it
  integrates the accepted task worktree changes, runs tests, reclaims task-owned
resources, removes the task worktree and merged branch, synchronizes the issue,
and attempts Blackboard archival.

The finalizer has hard safety gates for task identity, target branch, clean
target worktree, merge conflicts, and failed integration tests. Semantic scope
is a Lead acceptance decision, not a finalizer gate. The finalizer does not
require Blackboard to have converged to a particular agent state. Such
observations are returned as warnings. A target branch override is explicit,
recorded in finalization state, and frozen for retries.

Finalization is phase-based and idempotent. State is atomically replaced after
each completed phase. Merge conflicts are aborted; failures preserve remaining
task evidence and resources. The system does not attempt a global rollback of
already integrated Git commits. A retry resumes from the last durable phase.

The project's current integration branch is `develop`. Historical contracts
may retain another frozen `base_ref`; they require an explicit Lead-selected
target override and are never silently rewritten.

## Consequences

Lead retains decision authority and can intervene when the runtime or
Blackboard is stale. Operators get one information command and one execution
command instead of a large manual closure procedure. Finalizer output is the
source of lifecycle execution status, while Blackboard remains an observation
plane rather than a control bus.
