# Pi Team v2

Pi Team runs persistent module groups on native Windows. Each group has a Coordinator, Executor, Validator and fixed worktree. See ADR/0009-persistent-group-workflow.md for the normative protocol. Node 24.11+ and Pi 0.84.2 are the supported baseline; role credentials are configured in Pi, never in the repository.

## Implementation and verification status

This is the v2 implementation on `codex/group-runtime`. The canonical `develop` checkout and its v1 launcher have not been switched. Use this checkout's commands and protocol together; do not combine them with the v1 Researcher, contract-ACK or Blackboard workflow.

The deterministic suite passed 20 scenarios. A real module-onboarding task completed in an isolated project copy: exactly one plan review, D1, independent Executor/Validator runs of a 52-test core suite, passing code review, Coordinator delivery and Lead acceptance/integration in that copy. A clarification sent during implementation entered Executor's context at a tool boundary before submission. A provider outage required user-authorized temporary model replacement while preserving task/session history. This is bounded protocol evidence, not deployment into the original project or a model-quality comparison. Final Pi error-metadata adaptation and recovery-race corrections have deterministic coverage rather than another full real-provider run. See project_state.md for the verification boundary.

Legacy cutover and provisioning groups in original target repositories remain explicit follow-up work. Registered groups, completed tasks and live role processes are separate facts; inspect current runtime records before claiming any of them. Connection-only probes do not change model defaults or start tasks.

## Setup and cutover

Finish or explicitly close old v1 tasks using the old checkout before enabling v2. `pi-team.cmd inventory` lists unresolved legacy tasks; v2 refuses group creation/start while they remain. Archiving a Blackboard view does not by itself reconcile separate legacy launcher records. Old records are retained; no active sessions are migrated. Run `pi-team.cmd doctor` to inspect local prerequisites; it is not a live provider-availability check. Coordinator web tools are enabled only when pi-web-access is installed. New-session provider/model/tool configuration lives in .pi/roles.json; resumed sessions retain their persisted configuration. Editing defaults does not switch an already registered session.

Commands default to the harness source repository. When managing another project, set its absolute root first:

```powershell
$env:PI_TEAM_PROJECT_ROOT = 'D:/Work/example-project'
```

The project must already be a Git repository. Lead MCP calls instead require an explicit `project_root` argument. Inspect the selected project's inventory before performing mutations.

`pi-team.cmd codex-setup` registers the new `pi-team` stdio MCP server and attempts to remove a standalone agent-blackboard MCP registration. A separately installed Blackboard plugin connection must still be disabled explicitly during cutover. Lead tools are team_send, team_inbox, team_wait, team_inspect, team_accept and team_finalize. There is no autonomous Lead chat wakeup.

## Create and run a group

Create a JSON group descriptor:

```json
{"group_id":"payments","name":"Payments","worktree":"D:/Work/payments-group","base_ref":"develop"}
```

Save that descriptor as `group.json`. Run `pi-team.cmd group-create group.json` then `pi-team.cmd group-start payments`. Create a task JSON:

```json
{"task_id":"PAY-001","objective":"Return typed timeout errors","acceptance":["Timeout is observable as a typed error"],"base_ref":"develop"}
```

Save it as `task.json` and run `pi-team.cmd start payments task.json`. JSON arguments in this CLI are file paths, not inline JSON strings. The runtime creates a focused codex task branch and queues Coordinator work; a running group session processes it. Group creation requires an existing local base branch; task start also requires an explicit local `base_ref`, an idle group and a clean group worktree. One task is active per group.

## Workflow and evidence

Coordinator writes task.md. Executor writes plan.md. Validator writes one plan-review.md; Executor records concern handling and starts implementation without ACKs or a second plan-review round. Executor runs tests and creates local delivery commits. Validator reads the exact source/diff/tests and submits code-review-NN.md. Fixes create new deliveries. Coordinator resolves blockers in decision-N.md and sends final delivery.md to Lead after a pass.

Documents live in `groups/<group>/tasks/<task>/`; `groups/<group>/group.md` describes the module. Writing files is not a handoff: team_submit stores the document, completes owned work and creates the next work atomically. Documents are immutable after submission; implementation.md receives a new snapshot only in an authorized implementation round. Delivery code and documents stay fixed during review. Validator writes independent tests/logs under `review-NN/` in the task directory, leaves delivered `verification/` evidence unchanged, and does not create Git commits. Suggestions are separate from required fixes.

The role tools are team_read, team_send and team_submit. Runtime injects identity pinned to the current agent turn; use the owned `work_id` from team_read rather than reconstructing task/generation metadata. Successful submissions return `ok:true` with a transaction receipt. `ok:false` is a rejection, with a code and next action; no handoff occurred. Database work is authoritative even if a model says it finished.

New messages are steered at tool/turn boundaries without terminating running commands. Same-batch mutations wait for the next model response when steering is queued. Submission atomically rejects unpresented inbox arrivals; read/reconsider them before resubmitting. `presented_at` records presentation and `read_at` records successful turn settlement; neither alone proves the requested work was completed. An unresolved team-tool rejection or normal turn ending with open work emits a deduplicated durable Coordinator alert (Lead for Coordinator). An unfinished code review also opens a Coordinator resolution assignment. A successful recovered review cancels its obsolete escalation assignment.

Lead can use `pi-team.cmd send payments message.json`, where the file contains `{"body":"question"}`, or `inbox <group> [cursor]` and `wait <group> [cursor] [timeout-ms]` (maximum 55 seconds). Lead sends are routed to Coordinator. Messages remain stored; cursor reads filter results and do not delete or acknowledge them. The caller retains the last returned message ID as its next cursor. Only Coordinators contact Lead/other groups; group peers communicate directly.

`[current_state: "checking retries"]` at the start of assistant text updates a display string with observation time. Missing/bad prefixes cannot block or advance work. `status <group>` returns task/session records and Coordinator-owned open work; use `inspect <task>` for all roles' work and a process-liveness observation. Display text and session availability are not workflow completion evidence.

## Acceptance and operations

Run `inspect <task>` and independently check code/evidence. `accept <task> acceptance.json` reads a file containing `{"rationale":"evidence checked"}`. Then `finalize <task>` checks the accepted delivery and idle sessions, commits remaining process evidence, merges into the clean target branch named by the task's `base_ref`, runs integration tests, and returns the group to its idle branch without deleting its worktree or stopping sessions. Production or delivered-document drift prevents finalization. An integration/test failure is retained and retryable; a completed merge is not repeated.

The current CLI integration-test command is hard-coded to `node tests/run-tests.mjs` in the target project. Check that entrypoint before finalizing a non-Node project; other test runners are not automatically discovered. If the check fails after merge, finalization retains the merged state for repair/retry. The service library has an explicit `skipTests` option, used with recorded independent verification in the isolated Python-project test; the CLI/MCP do not expose that option, and skipping is not evidence that integration tests ran.

`close-incomplete <task> reason.json` reads `{"reason":"why"}`; preserve/commit dirty evidence before finalize returns to the idle branch and retains the incomplete task branch. `group-stop <group>` requires idle sessions; `--force` explicitly interrupts them. `group-resume <group>` reuses persisted sessions and recovers open work. `group-archive <group>` requires no active task, stops idle sessions and retains the worktree/evidence.

Run `node tests/run-tests.mjs` or `tests/run-tests.ps1` for v2 acceptance. Existing v1 test files describe retired interfaces and are excluded from the v2 entrypoint. Real provider smoke is a separate explicit check and never substitutes socket acknowledgements for causal artifacts.

Implementation notes: implementation.md and delivery.md retain runtime snapshots by delivery round; plans and individual review documents remain immutable. A blocked Review or Lead request-changes is resolved by Coordinator in decision-N.md before a new delivery. `request-changes <task> reason.json` reads {"reason":"required correction"}; it never creates a second plan-review round. Merged task branches are retained for provenance; explicit branch removal is a separate Lead operation. A model fault pauses retriggers; inspect its cause and use group-resume to retry deliberately. `setup` installs the pinned optional web-tools package; it does not change role credentials.
