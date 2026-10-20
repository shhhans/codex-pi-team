# Active v2 test migration

The active v2 entrypoint selects v2 suites; old tests remain historical protocol specifications and are not rewritten to make retired behavior pass. Use a pre-cutover revision when investigating v1 evidence. The current implementation and this test migration are under verification. This file records intended coverage and test selection, not a claim that the current suites pass or that live onboarding has been accepted.

| v1 concern | v2 replacement |
| --- | --- |
| Researcher/Executor/Validator role topology | Lead-owned module groups with Coordinator/Executor/Validator, direct same-group communication and Coordinator-only external contact |
| Contract body ACK, freeze, action limit and ruling | One submitted plan and one adversarial plan review, followed directly by implementation |
| Blackboard field/state gates and reminders | Optional `current_state` display parser with no lifecycle authority; durable work and inbox in SQLite |
| Role JSONL status and duplicated task metadata | Transactional runtime store with explicit task/generation, definition epoch and document/delivery identity |
| Task-local session launch/cleanup | Persistent group worktree, finite onboarding acknowledgements, definition-epoch session reset and task-role launch/recovery |
| Task close projection convergence | Independent Lead acceptance, configured project integration and retryable finalization |
| Compression/checkpoints | Real extension saves current work before compact, avoids concurrent requests and preserves work on failure |
| No module-doc review stage | Validator aligns explicitly assigned module Markdown after code pass; Coordinator checks the code/document commits, checklist and text |
| Unmanaged dev service lifecycle | Coordinator structured operations against `.pi/services.json`, with isolated review snapshots |
| Implicit project test command | Explicit target integration executable and args in `.pi/project.json` |

`node tests/run-tests.mjs` and `tests/run-tests.ps1` are the intended deterministic v2 entrypoints. The Node runner selects the v2 runtime, documentation-alignment, service-manager, group-registration, and Blackboard-related suites by filename. All five suites are required. The current complete parallel run passed 46/46 scenarios; see project_state.md and the retained deterministic-final.log for the exact evidence.

`node tests/live-group-lifecycle.mjs` is a separate live lifecycle harness that invokes configured real model providers in an isolated temporary repository; it is not part of deterministic tests and may incur provider use. A live run must be separately authorized and reported with its specific runtime evidence and scope. Do not describe older isolated-copy results as acceptance of later implementation changes or original-project deployment.
