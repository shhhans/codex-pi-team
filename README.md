# Pi Team v2

Pi Team runs persistent module groups on native Windows. Each group has a Coordinator, Executor, Validator and fixed worktree. See ADR/0009-persistent-group-workflow.md for the normative protocol. Node 24.11+ and Pi 0.84.2 are the supported baseline; role credentials are configured in Pi, never in the repository.

## Setup and cutover

Finish or explicitly close old v1 tasks using the old checkout before enabling v2. `pi-team.cmd inventory` lists unresolved legacy tasks; v2 refuses group creation/start while they remain. Old records are retained; no active sessions are migrated. Run `pi-team.cmd doctor` to inspect runtime readiness. Coordinator web tools are enabled only when pi-web-access is installed. Role provider/model/tool configuration lives in .pi/roles.json.

`pi-team.cmd codex-setup` registers the new `pi-team` stdio MCP server. Retire the old agent-blackboard MCP registration during cutover. Lead tools are team_send, team_inbox, team_wait, team_inspect, team_accept and team_finalize. There is no autonomous Lead chat wakeup.

## Create and run a group

Create a JSON group descriptor:

```json
{"group_id":"payments","name":"Payments","worktree":"D:/Work/payments-group","base_ref":"develop"}
```

Run `pi-team.cmd group-create <group-json>` then `pi-team.cmd group-start payments`. Create a task JSON:

```json
{"task_id":"PAY-001","objective":"Return typed timeout errors","acceptance":["Timeout is observable as a typed error"],"base_ref":"develop"}
```

Run `pi-team.cmd start payments <task-json>`. The runtime creates a focused codex task branch and wakes Coordinator. Group creation and task start require clean, explicit Git baselines. One task is active per group.

## Workflow and evidence

Coordinator writes task.md. Executor writes plan.md. Validator writes one plan-review.md; Executor records concern handling and starts implementation without ACKs or a second plan-review round. Executor runs tests and creates local delivery commits. Validator reads the exact source/diff/tests and submits code-review-NN.md. Fixes create new deliveries. Coordinator resolves blockers in decision-N.md and sends final delivery.md to Lead after a pass.

Documents live in `groups/<group>/tasks/<task>/`; group.md describes the module. Writing files is not a handoff: team_submit stores the document and creates the next work atomically. Documents are immutable after submission except implementation.md, which receives a versioned snapshot each round. Review tests belong below the task directory. Suggestions are separate from required fixes.

Use `pi-team.cmd send <group> <message-json>` with `{"body":"question"}`, `inbox <group> [cursor]`, or `wait <group> [cursor] [timeout-ms]` (maximum 55 seconds). Messages persist until read by cursor; only Coordinators contact Lead/other groups. Group peers communicate directly.

`[current_state: "checking retries"]` at the start of assistant text updates a display string with observation time. Missing/bad prefixes cannot block or advance work. Use `status <group>` for open work, task and sessions; display text may be stale.

## Acceptance and operations

Run `inspect <task>`; independently check code/evidence. `accept <task> <json>` requires `{"rationale":"evidence checked"}`. Then `finalize <task>` integrates from the clean target branch, runs integration tests, commits remaining process documents, and returns the group to its idle branch without deleting its worktree or stopping sessions. New production changes invalidate acceptance. An integration/test failure is retained and retryable; a completed merge is not repeated.

`close-incomplete <task> <json>` requires `{"reason":"why"}`; preserve/commit dirty evidence before finalize detaches and retains the incomplete branch. `group-stop <group>` requires idle sessions; `--force` explicitly interrupts them. `group-resume` reuses persisted sessions and recovers open work. `group-archive` requires no active task and retains the worktree/evidence.

Run `node tests/run-tests.mjs` or `tests/run-tests.ps1` for v2 acceptance. Existing v1 test files describe retired interfaces and are excluded from the v2 entrypoint. Real provider smoke is a separate explicit check and never substitutes socket acknowledgements for causal artifacts.

Implementation notes: implementation.md and delivery.md retain runtime snapshots by delivery round; plans and individual review documents remain immutable. A blocked Review or Lead request-changes is resolved by Coordinator in decision-N.md before a new delivery. `request-changes <task> <json>` accepts {"reason":"required correction"}; it never creates a second plan-review round. Merged task branches are retained for provenance; explicit branch removal is a separate Lead operation. A model fault pauses retriggers; inspect its cause and use group-resume to retry deliberately. `setup` installs the pinned optional web provider; it does not change role credentials.
