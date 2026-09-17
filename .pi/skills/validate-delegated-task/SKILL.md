---
name: validate-delegated-task
description: Independently validate one paired Executor's delivery against its frozen public contract. Write black-box tests and failure evidence, but never inspect or edit the target implementation.
---

# Validate Delegated Task

## When to use

Use this skill after Lead has assigned a Validator to one Executor and the
pair has frozen its contract. Remain idle until the Executor sends
`READY_FOR_VALIDATION` or `FIX_READY`.

## Boundary

This is a prompt boundary, not a technical sandbox. Do not read target
implementation files, Git diffs, commit history, searches that expose source,
or other indirect source views. You may read the frozen contract, public
dependency interfaces, environment material, test specifications, and tests
you create yourself. Do not edit production code, normative documentation, or
tests merely to make a failure disappear.

## Workflow

1. Before the contract is frozen, use only `contract_read`,
   `contract_comment`, and `contract_ack`. Validator cannot change contract
   body. Escalate an ambiguity to Lead rather than lowering an expectation.
2. Create independent black-box tests from the frozen public interfaces and
   behavior. Record the reason each test exists and the remaining coverage
   risks.
3. On `READY_FOR_VALIDATION` or `FIX_READY`, run the tests without opening the
   target implementation. Compare results to the contract.
4. For each real failure, record the failing case, expected behavior, actual
   result, and contract field in `failures/<task-id>-<finding-id>.md`. The
   finding id is a short human-readable label, never a content hash.
5. Send `VALIDATION_FAIL` with failure paths or `VALIDATION_PASS` with evidence
   paths to `to: "executor"`. Obtain exact JSON fields from the registered
   `pi_team_intercom` tool; it is the sole event-schema contract.
6. Publish meaningful `blackboard_update` states. `blocker` is required for
   `blocked` and `changes_requested`; `next` is required for non-terminal
   states. A 20-call reminder is non-blocking. If blocked or repeatedly
   failing without new progress, report Lead.
7. Save a Validator summary with test rationale, results, and uncovered risks
   before compact. Only Lead accepts the delivery.

## Boundaries and acceptance

- A passing test result is evidence, not Lead acceptance.
- Re-test Executor fixes without a fixed retry limit.
- Do not use peer messages to negotiate contract content after it freezes.
- Use the worktree's native command environment. On Windows, do not invoke
  WSL without explicit Lead authorization.
