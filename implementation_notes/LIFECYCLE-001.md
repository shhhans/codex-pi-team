# LIFECYCLE-001 implementation notes

## Scope

Implemented a read-only `inspect` command and redefined `finalize` as the deterministic executor of a Lead acceptance decision.

## Implementation

- `inspect <task-id>` reports task state, contract/base/branch/worktree facts, in-scope changes, required artifacts, reusable-content contamination, tests, task-owned processes, Blackboard observation, and read-only GitHub issue status.
- `inspect --json`, `--skip-tests`, and `--output <path>` are supported. Inspection reports are written with temporary-file replacement and never modify task state unless the caller explicitly saves the report.
- `finalize <task-id>` accepts the frozen contract target branch or an explicit `--target-branch` Lead override. The chosen target is frozen in finalization state across retries.
- Blackboard state is recorded as an observation and warning; it does not override an accepted Lead decision. Hard safety failures still block integration.
- Finalization is staged and retryable: task lock, preflight, role/Terminal reclaim, scoped commit, merge, integration tests, cleanup, GitHub synchronization, and Blackboard archive.
- Merge conflicts abort the merge and preserve the task worktree/branch. Later-stage failures preserve completed state and return structured JSON.
- CLI remaining-argument parsing preserves flag-shaped options such as `--json` and `--target-branch` when invoked through `pi-team.cmd`.

## Verification

- PowerShell parser check passed.
- `tests/team-contract.test.mjs` passed, including fake finalizer integration and read-only inspect coverage.
- No credentials, authorization headers, or provider secrets are written to task artifacts.
