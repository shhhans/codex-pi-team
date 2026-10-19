# Active v2 test migration

The default runner now verifies ADR 0009. Old tests are preserved, not rewritten to make removed protocols pass. Run the old protocol suites from a pre-cutover revision when investigating v1 evidence.

| v1 concern | v2 replacement |
| --- | --- |
| Researcher/Executor/Validator role topology | Coordinator/Executor/Validator, direct same-group communication, Coordinator-only external contact |
| Contract body ACK, freeze, action limit and ruling | One submitted plan and one adversarial plan review, followed directly by implementation |
| Blackboard field/state gates and reminders | Optional current_state parser with no lifecycle authority; durable work/inbox in SQLite |
| Role JSONL status and duplicated task metadata | One transactional store; explicit task/generation and document/delivery identity |
| Transport receipt/replay tests | Cross-process idempotent handoff, crash rollback, recovered open work and actual extension tools |
| Task-local session launch/cleanup | Windows native/hidden launch, persisted configuration/session restoration, fixed worktree and consecutive tasks |
| Task close projection convergence | Independent Lead acceptance and retryable integration, without requiring display-state convergence |
| Compression/checkpoints | Real extension saves current work before compact, avoids concurrent requests and preserves work on failure |

`node tests/run-tests.mjs` runs the 15 v2 behavior scenarios, including real installed Pi extension loading and a native PowerShell command. Set PI_TEAM_PI_PACKAGE_ROOT if the installed Pi package is outside the standard Windows npm location.

`node tests/live-group-smoke.mjs` explicitly runs configured paid model providers in a standalone temporary repository. It is not part of deterministic tests. It exercises a deliberate failing first delivery, repair, review, Coordinator report, session replacement and a second task. Its stdout reports the runtime evidence directory; raw sessions and host paths are not committed as source.
