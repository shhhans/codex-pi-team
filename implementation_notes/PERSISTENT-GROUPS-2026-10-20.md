# Persistent group registration and lifecycle

Implemented on `codex/group-runtime`, based on `40b7f00`. The canonical
`develop` checkout, original-project group registrations and global MCP
configuration are not changed by this work.

## Delivered behavior

- A valid `groups/<id>/group.md` is the registration source. Lead CLI/MCP
  creation writes scalar YAML front matter and responsibility Markdown,
  provisions the fixed worktree, and schedules finite real-model onboarding.
  An independent Blackboard observes configuration, lifecycle and role state.
- Executor and Validator each submit a runtime-bound ACK; Coordinator submits
  after both. Initialization becomes ready only after settled roles stop.
  Receipts, interrupted-session recovery, unfinished ACK alerts and explicit
  retry are durable. Printed tool syntax is never a receipt.
- Desired responsibilities wait for the active task to finish. Applying them
  quiesces processes/services, archives session registrations, replaces all
  three conversations and fences stale inbox/context by definition epoch.
  Shared role-description changes also require onboarding again.
- Lead syncs a clean fixed worktree from a committed baseline before tasks.
  Concurrent Lead changes during integration may contain group definitions
  only; other implementation drift requires another reviewed delivery.
- Coordinator manages structured service specifications. Review services use
  an isolated Git snapshot and separate data/log paths. Shared external
  dependencies remain read-only. Stops verify process creation identity;
  Windows quota/cancellation failures have an installed-PowerShell-7 native
  process-tree fallback. Stale service locks require explicit proved-owner
  recovery.
- After code passes, Validator aligns explicitly delegated module Markdown.
  Runtime commits only that prose from an empty index. Coordinator checks
  documentation separately before delivery. Code and documentation commits
  are bound together; Lead finalization runs `.pi/project.json` integration.

## Verification

The complete parallel deterministic entrypoint `node tests/run-tests.mjs`
passed **46/46 tests**, with no failures or skipped scenarios. The inexpensive
Luna testing subagent performed the final run and retained its complete log.

`node tests/live-group-lifecycle.mjs` completed in a standalone temporary Git
repository with the configured MiniMax Coordinator/Executor and DeepSeek
Validator, without changing provider configuration or substituting a model.

The final fresh run completed both three-role onboarding epochs, an actual
implementation and independent code review, Validator documentation alignment,
Coordinator documentation review and delivery, a review service pinned to the
registered code commit, independent HTTP result inspection, Lead acceptance
and configured integration tests. The module and documentation both report
`result = 2`. Session IDs changed for all roles after the responsibility
update. All role processes and the managed fixture service were stopped.

The first attempt exposed premature shutdown after the Coordinator receipt.
An intermediate run exercised explicit cleanup recovery and Lead-assisted
correction of a model response containing faux tool syntax. Both failures and
recovery evidence are retained, alongside the fresh successful run. Auxiliary
service-lock, external-ownership and process-stop fallback paths are covered
by deterministic/native process tests, rather than another paid provider run.

## Evidence and limits

Raw results, model sessions, Git/task artifacts, source snapshots and test
logs are retained outside Git under:

`<git-common-dir>/pi-team-runtime/v2/verification/persistent-registration-2026-10-20T07-36-32.944Z/`

The authoritative real-run result is
`pi-live-lifecycle-dRX7WL/result.json`. Earlier attempts are preserved in
separate sibling directories. `deterministic-final.log` records the complete
parallel deterministic entrypoint outcome. This verifies the bounded
single-task/two-definition lifecycle in an isolated project. It does not
establish original-project deployment, v1 cutover, or long-term unattended
module maintenance.
