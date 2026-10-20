# Pi Team shared context

Read this before exploring. Use native Windows commands; never invoke WSL without Lead authorization.

## Active architecture

The normative protocol is ADR/0009-persistent-group-workflow.md. ADR 0002 describes the superseded v1 workflow. The supported entrypoint is pi-team.cmd; scripts/pi-team.ps1 forwards to the v2 Node CLI. Node 24.11 or newer and Pi 0.84.2 are the supported runtime baseline.

Each persistent group owns one module, one fixed Git worktree and three long-lived sessions: Coordinator, Executor and Validator. A group handles one task at a time. Lead owns external objectives, module boundaries, acceptance and integration. Coordinator arranges work and outside communication; Executor plans/implements; Validator performs exactly one adversarial plan review and subsequent source/diff/test reviews. Validator may read production source but must not edit it.

## Navigation

- .pi/roles.json is the single launch configuration for providers, models, tools and role skills.
- .pi/agents/ contains the three active role instructions. .pi/skills/coordinate-group, execute-group-task and review-group-task contain their private workflows. Other role skills are retired v1 material and are not loaded.
- .pi/runtime/group-store.mjs owns the SQLite authority; group-service.mjs owns Git and process lifecycle.
- .pi/communication/extensions/group.ts exposes team_read, team_send and team_submit, handles durable inbox recovery and display-only current_state prefixes.
- plugins/pi-team/server.mjs exposes Lead inbox/wait/send/inspect/accept/finalize tools. Blackboard tools, contract negotiation and ACKs are retired.
- groups/<group>/group.md describes the module. groups/<group>/tasks/<task>/ contains process evidence, committed with the code.
- tests/run-tests.ps1 or node tests/run-tests.mjs runs active behavior and real-extension loading tests. Older tests are v1 specifications, not v2 acceptance evidence.

## Communication and evidence

Use team_read for current task_id/generation and open work. team_submit atomically records a document snapshot, completes the work and queues the successor. Writing a file or sending chat does not submit a result. Duplicate submissions are idempotent; submitted plans and review reports are immutable. implementation.md gets a snapshot for each delivery. Full Git commits bind code Review; human prose uses D1, D2, etc.

Use team_send for questions and answers. All three same-group roles may communicate. Only Coordinator contacts Lead or other Coordinators. Inter-group commitments and scope expansion require Lead. No Agent accepts, merges or pushes. Executor is authorized to create local delivery commits on the task branch. Normal repair/review loops do not require Coordinator approval.

Begin assistant text with [current_state: "a concrete activity"]. Malformed or absent prefixes never block work or imply completion. Do not poll, invent lifecycle state calls, construct transport envelopes or create unassigned subtasks. End each completed turn idle; sessions and worktrees persist across tasks.

## Hygiene and cutover

Reusable role instructions and skills remain task-agnostic. Put task details in process documents and runtime context. Never modify existing .pi/legacy/ history. Preserve old runtime records and current user changes. v2 refuses to start groups while unresolved v1 tasks remain; close them explicitly using the pre-cutover checkout rather than silently migrating them. Stable snapshots are architect.md, goal.md and project_state.md; update them when architecture or operations change, not per message.

The role-tools boundary in .pi/runtime/role-tools.mjs injects turn identity. Use work_id when submitting; only ok:true receipts prove handoff. Rejections and unfinished work are durable Coordinator concerns. Incoming messages can steer a running turn at tool boundaries; check and handle them before delivery. Review evidence belongs under review-NN/, separate from delivered verification files.
