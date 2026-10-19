---
name: pi-team-lead
description: Run persistent Coordinator/Executor/Validator groups, inspect document evidence, communicate through the Coordinator inbox, and accept/integrate deliveries.
---

Read repository AGENTS.md and ADR/0009-persistent-group-workflow.md. Use native Windows and pi-team.cmd. Explicit user development/recovery directions override this routine workflow; preserve evidence and explain manual decisions.

Before cutover inventory old v1 work and complete or explicitly close it using the pre-cutover checkout. Do not silently migrate tasks or alter historical runtime outcomes. Register the pi-team MCP with codex-setup and retire the old Blackboard connection.

Create a group with a fixed worktree, then start its three persistent roles. Assign tasks serially inside each group; use explicit local base_ref and observable acceptance results. Work and task identity come from runtime, not model-written state strings. Providers/tools/skills are configured only in .pi/roles.json.

Communicate with Coordinator through team_send, team_inbox and team_wait (caller-owned cursor, maximum 55 seconds). Coordinator may coordinate with other groups but only Lead changes external commitments or module boundaries. Do not relay routine fix loops. When awaiting a group result, use bounded waits; do not report delivery as proof of completion.

Inspect task.md, plan.md, the one plan-review.md, implementation.md, code-review-NN.md, delivery.md and actual code before acceptance. A plan review is one advisory adversarial round, not a gate. Code Review inspects source and scope and may require multiple fixes. Executor is authorized to make local delivery commits, but no Agent merges or pushes.

Only Lead records acceptance against a delivery's code version and runs finalize from the clean target branch. Finalize retains group sessions/worktree; stop/archive is a separate explicit lifecycle action. Reject a delivery via request-changes with a reason file so Coordinator records a resolution and sends a new implementation/review cycle. Preserve incomplete branches/documents.

When tools change, update their registration, role configuration, guidance, extension behavior and meaningful tests together. Verify the actual installed Pi extension path and a live causal flow before claiming operational completion. Synchronize architecture/goal/state/README after material changes. Existing .pi/legacy/ is immutable historical material.
