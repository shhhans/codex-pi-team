# Pi Team shared context

Read this before exploring. Use native Windows commands; never invoke WSL without Lead authorization.

## Implementation and deployment boundary

This checkout contains the v2 persistent-group implementation, including configuration registration, finite onboarding, documentation alignment and structured services. The current increment passed the parallel deterministic suite and bounded real three-role lifecycle acceptance in an isolated project; see project_state.md for scope and evidence. These results do not establish original-project deployment or long-term unattended maintenance. Do not report tests, live onboarding, original-project provisioning, cutover or group registration as completed unless you inspect the relevant current evidence. Detailed prior outcomes belong in `project_state.md` and runtime verification artifacts; the Lead owns final updates to that operational snapshot.

The active `develop` implementation is persistent-group v2. Use its CLI and ADR 0009; v1 work is retained only as historical branches/records and is not automatically migrated. Original-target provisioning and reconciliation of unfinished legacy tasks remain explicit Lead work. Preserve legacy records and uncommitted changes. Connection-only provider probes do not change role configuration or authorize tasks.

## Start here

- The supported Windows entrypoint is `pi-team.cmd`; lifecycle implementation is `scripts/pi-team.ps1` and `scripts/pi-team-v2.mjs`.
- The normative v2 protocol is `ADR/0009-persistent-group-workflow.md`.
- Stable architecture and goal snapshots are `architect.md` and `goal.md`. `project_state.md` is an operational snapshot and is maintained by Lead.
- `groups/<id>/group.md` is the durable module-group definition. Runtime state is a projection and does not by itself prove the definition is committed or onboarding is complete.
- `.pi/communication/extensions/group.ts`, `.pi/runtime/` and `scripts/group-init-runner.mjs` contain active runtime behavior. Historical material under `.pi/legacy/` is non-normative; do not modify it.
- `.pi/agents/` contains Coordinator, Executor and Validator instructions; `.pi/skills/` contains their active private workflows.
- The deterministic test entrypoint is `tests/run-tests.ps1`; the cross-shell Node entrypoint is `node tests/run-tests.mjs`. Do not run tests unless the Lead requests verification or the assigned task requires it.

## Group definitions and onboarding

Lead owns group definitions. YAML front matter in `groups/<id>/group.md` contains `schema_version: 1`, `id`, `name`, absolute `worktree`, `base_ref` and optional `archived`; its Markdown body states module responsibility and boundaries. Directory and header IDs must match. Lead commits definitions in the target checkout before task work and uses `group-sync` only with clean Lead state and a clean idle group worktree.

`group-create`/`team_group_create` registers a definition and schedules finite onboarding. Real Executor and Validator sessions each submit an explicit responsibility acknowledgement; Coordinator submits only after both and reports its receipt to Lead. Onboarding is not business work; the runner stops all three sessions. `group-init`/`team_group_init` retries onboarding only after inspecting its fault. `group-update`/`team_group_update` changes desired responsibility; a new definition must wait for a safe task boundary, reset all three role sessions and require fresh acknowledgements. Do not start a task from stale or uncommitted group configuration.

## Active roles and boundaries

- Coordinator coordinates one task within Lead scope, writes process documents, handles external communication, and independently reviews Validator's module-documentation alignment. Coordinator uses structured `team_service` actions only for services declared in the target `.pi/services.json`.
- Executor implements one Lead-assigned task in the group's fixed worktree, creates local delivery commits and maintains implementation evidence.
- Validator independently reviews one frozen plan and each delivered code version. After a code review passes, Validator may edit only the explicitly delegated module Markdown paths and its documentation report; it does not edit production code.
- Lead owns group identity, module boundaries, objective, delegation, acceptance, target integration and cutover. Agents report blockers or unrelated defects to Lead through Coordinator and do not widen their assignment.

## Task and document workflow

There is at most one active task per group. The Lead-owned task includes objective, acceptance results, base ref and, when needed, explicit `documentation_paths` and `documentation_checklist`. Coordinator writes `task.md` and selects direct implementation, plan-only, or a plan with one adversarial review. Only the selected route requires `plan.md` and/or `plan-review.md`. The plan review is advice, not a pass/ACK gate. Executor reads it and implements while recording concern handling. A second plan-review round is prohibited.

After each Executor delivery, Validator reviews its exact commit/source/diff/tests and submits `code-review-NN.md`. Following a passing code review, Validator checks assigned module Markdown against delivered behavior and submits a documentation report. Runtime commits only the explicit documentation paths. Coordinator checks the exact code commit, documentation commit, checklist and actual module text, then passes or returns that revision. Delivery to Lead requires both reviews to pass. Lead alone accepts and integrates. Process files live under `groups/<group>/tasks/<task>/`; independent Validator evidence lives under `review-NN/`.

## Runtime, services and validation

SQLite below `<git-common-dir>/pi-team-runtime/v2` owns work, messages, session identity, receipts and recoverable projections. Documents are written before explicit `team_submit`; a successful `ok:true` receipt proves handoff. Use runtime-injected identity and `work_id`; writing a file, chat prose, process availability and `current_state` do not advance workflow. Only Coordinator contacts Lead or another group; same-group peers communicate directly. Handle steering messages before submitting. Unfinished work and rejected team tools require recovery, not a completion claim.

Coordinator's `team_service` offers describe/status/start/stop for named entries in `.pi/services.json`; arbitrary shell command strings are unsupported. Development mode uses the group worktree; review mode exports an explicit delivery commit to an isolated snapshot. The target `.pi/project.json` declares finalization's integration executable and string-array args. Lead acceptance is required before finalization.

Use `inventory`/`team_groups` and inspect persisted records before saying a group is registered, onboarded or running; these are separate states. `doctor` is a local prerequisite check, not proof of provider availability. Keep test results, live-provider evidence and original-project deployment distinct. Do not mark the current implementation complete based on prior runs.

## Reusable-content hygiene

Keep this file, active role prompts and active skills task-agnostic. Do not add task identifiers, issue numbers, task-only artifacts, host paths, raw prompts, envelopes, audit rows or runtime traces. Task-specific scope belongs in the assigned task document or runtime context.

## Optional task planning

Coordinator may submit task work with planning=direct, plan, or review; omission retains review. Direct tasks need no plan artifacts. Choose proportionately; final independent code/documentation reviews and Lead acceptance remain required. Do not expand Lead scope to satisfy an optional process.
