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

- Coordinator coordinates one task within Lead scope, writes process documents, handles external communication, and checks combined review/version bindings during delivery. Existing unclassified tasks retain independent documentation-review work. Coordinator uses structured `team_service` actions only for services declared in the target `.pi/services.json`.
- Executor implements one Lead-assigned task in the group's fixed worktree, creates local delivery commits and maintains implementation evidence.
- Validator independently reviews one frozen plan and each delivered code version. During classified change-task review, or after code passes in legacy documentation work, Validator may edit only explicitly delegated module Markdown and its assigned report; it does not edit production code.
- Lead owns group identity, module boundaries, objective, delegation, acceptance, target integration and cutover. Agents report blockers or unrelated defects to Lead through Coordinator and do not widen their assignment.

## Task and document workflow

There is at most one active task per group. The Lead-owned task includes objective, acceptance results, base ref and, when needed, explicit `documentation_paths` and `documentation_checklist`. Coordinator declares task_type=non_change, small_change, or large_change on initial team_submit(kind=task), records a short reason in task.md, and preserves it after submission. Non-change tasks modify only their own task records, analysis or review artifacts; product code, tests, configuration and module documentation remain unchanged. Small changes are bounded with a known solution; large changes involve material design/interface/state/concurrency/recovery/compatibility risk. Judge impact and uncertainty, not line count. Defaults are direct for non-change/small changes and review for large changes; plan remains available for design uncertainty. Classification never expands Lead scope. Coordinator writes `task.md` and selects direct implementation, plan-only, or a plan with one adversarial review. Only the selected route requires `plan.md` and/or `plan-review.md`. The plan review is advice, not a pass/ACK gate. Executor reads it and implements while recording concern handling. A second plan-review round is prohibited.

For classified tasks, Validator checks the exact delivery commit, source/diff and acceptance evidence in one code-review-NN.md. For non_change, verify no base-to-delivery changes outside the task directory; mismatch is blocked for Coordinator/Lead resolution, never silently reclassified. For change tasks, review code/tests first, then check the documentation checklist and align only explicitly delegated module Markdown or explain no change. On passing code_review, runtime commits only authorized Markdown, binds code/documentation commits to the combined review and opens Coordinator delivery directly. There are no separate documentation or Coordinator documentation-review reports. Coordinator checks acceptance, exact version bindings and unresolved issues while preparing delivery.md; Lead alone accepts and integrates. Each fix needs a new delivery and independent review. Existing tasks/callers omitting task_type retain the legacy separate documentation/alignment-review stages and artifacts; no automatic migration.

## Runtime, services and validation

SQLite below `<git-common-dir>/pi-team-runtime/v2` owns work, messages, session identity, receipts and recoverable projections. Documents are written before explicit `team_submit`; a successful `ok:true` receipt proves handoff. Use runtime-injected identity and `work_id`; writing a file, chat prose, process availability and `current_state` do not advance workflow. Only Coordinator contacts Lead or another group; same-group peers communicate directly. Handle steering messages before submitting. Unfinished work and rejected team tools require recovery, not a completion claim.

Coordinator's `team_service` offers describe/status/start/stop for named entries in `.pi/services.json`; arbitrary shell command strings are unsupported. Development mode uses the group worktree; review mode exports an explicit delivery commit to an isolated snapshot. The target `.pi/project.json` declares finalization's integration executable and string-array args. Lead acceptance is required before finalization.

Use `inventory`/`team_groups` and inspect persisted records before saying a group is registered, onboarded or running; these are separate states. `doctor` is a local prerequisite check, not proof of provider availability. Keep test results, live-provider evidence and original-project deployment distinct. Do not mark the current implementation complete based on prior runs.

## Reusable-content hygiene

Keep this file, active role prompts and active skills task-agnostic. Do not add task identifiers, issue numbers, task-only artifacts, host paths, raw prompts, envelopes, audit rows or runtime traces. Task-specific scope belongs in the assigned task document or runtime context.

## Optional task planning

Coordinator may submit task work with planning=direct, plan, or review; omission retains review. Direct tasks need no plan artifacts. Choose proportionately; independent combined review and Lead acceptance remain required; legacy unclassified tasks retain separate documentation stages. Do not expand Lead scope to satisfy an optional process.

## Runtime context and shared knowledge

Runtime injects authoritative versioned work cards, artifact paths, exact delivery/documentation commits and relevant messages before work and in steering notifications. Stable contracts appear once per context version in durable session messages. A complete notification permits action without an extra team_read call. Read referenced task/review documents before acting. Use team_read for missing context, rejection, restart or compaction recovery (refresh_context:true); shared_context:true explicitly retrieves published team knowledge. No work means end idle. Submission identity, stale-turn checks and message handling still apply.

Coordinator writes task.md before initial dispatch and preserves it after submission. Later decisions use messages or assigned decision artifacts. Choose direct for known bounded changes, plan for coordination/design uncertainty, review for substantial state/concurrency/recovery/compatibility risks. Extra verification needs a concrete risk, new assumption or failed result. Independent review and Lead acceptance remain required.

Coordinator maintains cross-task shared knowledge in a concise replacement section headed exactly `## Shared knowledge` in delivery.md (maximum 6000 characters), with source references. Submit delivery with shared_context:{mode:"update"}, or reuse the current published version with {mode:"reuse",version:N}. Omission remains compatible and publishes nothing. Runtime freezes content, hash, definition epoch, source task/path and code commit with the delivery. Lead checks changed knowledge in existing acceptance. SQLite publishes a version and integration commit only when accepted finalization succeeds, including joint integration; retries are idempotent. Failed, incomplete or rejected tasks publish nothing. Notifications carry a pointer; retrieve content only when relevant. History is retained; a definition epoch change requires fresh knowledge before it is current. Role continuation uses existing automatic compaction.
