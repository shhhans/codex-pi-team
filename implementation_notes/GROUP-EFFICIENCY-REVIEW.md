# Group efficiency and joint snapshot adversarial review

Scope: read-only review of commits `0b74c29` and `b19eecd`, the working-tree joint snapshot implementation and its tests, plus the stated v2 contract in `AGENTS.md`, `README.md`, and ADR 0009. No suite or real provider was run. The working tree was already modified by the integration implementation work; this report does not claim those modifications passed validation.

## Findings

### Medium: late binding races the verification task's first submission

`bindIntegrationVerification` reads the task, checks `delivery?.commit` is absent, then writes a modified task record in a separate operation. Unlike task start/submission, this sequence is not wrapped in a SQLite transaction that includes the check and update. The verification role can therefore submit its first delivery between the read and `store.put`; the bind can overwrite the newly written task row with its earlier copy, losing the delivery/review progression or allowing the bind to succeed after the “before first delivery” condition has ceased to hold. The in-process group lock does not by itself serialize `team_submit` in another process unless submission also checks/acquires that lock.

Relevant code: `.pi/runtime/integration-snapshot.mjs`, `bindIntegrationVerification`; `.pi/runtime/group-store.mjs`, `submit` and `put`.

Small repro: run binding and first verification `team_submit` in separate processes against one runtime DB. Add a temporary barrier after bind's task read and before its write; submit the first delivery while paused, then release the bind. Assert either binding rejects without changing the submitted task or the binding wins before submission begins. Also assert delivery/work/artifact rows remain mutually consistent. The invariant should be enforced atomically in SQLite, not by timing.

### Medium: RPC runner failure can leave a live Pi child without its pipe owner

The new headless launcher tracks the Pi process PID as the session and the wrapper as `launcher_pid`. `group-role-runner.mjs` uses synchronous file appends in stdout/stderr data callbacks and has no child cleanup handler for wrapper failure/signals. If a log append throws (for example, runtime volume full) or the wrapper is terminated independently, the runner can exit while Pi remains alive with its RPC stdin pipe still open; the database then continues to report a live role, and `stopGroup` targets the recorded Pi PID but only waits for the wrapper when it is still present. This is a narrow operational failure mode, not a claim that normal shutdown is broken.

Small repro: use a fake Pi RPC child that records its PID and stays alive; force the runner's log append to fail or terminate only the runner. Verify the child is terminated or the session is durably marked faulted and recoverable. A second probe should exercise ordinary stop/restart to confirm the wrapper and child both quiesce.

## State and scope checks

- Context compaction invalidates the read cache on successful compaction, restores claimed-but-unsettled messages, and makes the next `team_read` include the contract. Per-turn system context carries task/generation/definition identity and work IDs without historical ACK bodies. I did not find a concrete safety-context loss in the inspected path; a useful focused check is restart/compaction with a claimed cross-group message plus an active verification binding, then confirm the message appears once and task/snapshot identity is current.
- Cross-group message records now use the receiver's active task for inbox eligibility and preserve sender task as `source_task_id`; the message is not silently filtered when task IDs differ.
- The exact source boundary for member candidate inputs is indirect: candidate creation merges the current process-evidence commit, while `assertDelivery` constrains changes after the registered delivery to task evidence and delegated docs. This appears consistent with retaining process evidence, but the test suite should explicitly put an unauthorized production commit after the reviewed delivery and prove candidate creation rejects it.
- Existing candidate tests cover clean baseline, candidate drift, test retry, changed review evidence, evaluation scope, cleanup retry, and merge conflict. They do not exercise concurrent bind/submit or runner-owner failure above.
- The observed `creation_failed` manifest originally had no `snapshot_commit/tree`, while bind/finalize lacked an explicit failed-status rejection. The Lead reports that the implementation agent has been asked to fix this during the review. Treat it as a known in-flight correction; require a regression test that bind and finalize reject `creation_failed` before they call candidate integrity or write task state.

## Acceptance probes before relying on this increment

1. Deterministically interleave verification bind with first delivery and assert no lost task update or late binding.
2. Inject runner log-write failure and wrapper-only termination; verify child cleanup and truthful session state.
3. Create a partial candidate failure, then call both bind and finalize; both must reject the failed status and preserve its diagnostic manifest.
4. Run the documented three-group lifecycle with three distinct task IDs, independent evaluator task, real configured integration command, and exact candidate binding. Do not substitute smaller acceptance criteria or a model/provider stub for the requested real parallel-group check.

