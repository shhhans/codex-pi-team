---
name: pi-team-lead
description: "Run Lead-owned development and research tasks through the local Pi Team with Agent Blackboard observability. Use whenever Codex is asked to use Pi Team, delegate to Researcher, Executor, or Reviewer, publish or start a Pi task, manage a persistent Executor-Reviewer pair, or coordinate acceptance, reclamation, and Blackboard archival, including when the session starts above the Pi-team repository."
---

# Pi Team Lead

Use the repository's stable Windows entrypoint to run Pi roles, and use Agent
Blackboard only to observe their self-reported activity. Creating a Blackboard
lane does not launch Pi Team.

## Establish the project root

1. Prefer a project root supplied by the user or the current task.
2. Otherwise locate `Pi-team/pi-team.cmd` within the current workspace using a
   read-only file search, then resolve the absolute `Pi-team` directory.
3. Read that root's `AGENTS.md`,
   `ADR/0002-lead-subagent-collaboration-protocol.md`, and the formal task
   contract before delegation. A session started above the repository might
   not have loaded the nested `AGENTS.md` automatically.
4. Pass the absolute project root to every Blackboard tool.

Use native Windows PowerShell and the project-local `pi-team.cmd`. Do not use
WSL, Git Bash, `runs.run`, Codex subagents, `--agent`, or ambient Pi extensions
to launch Pi roles.

`AGENTS.md` is the stable, task-agnostic context inherited by active roles.
The launcher supplies task-specific scope and delegation details at runtime;
do not copy those details into reusable prompts, skills, or `AGENTS.md`.

## Own the task as Lead

The User and Lead own architecture and product decisions. The Lead owns the
task ID, name, description, scope, done criteria, Executor-Reviewer pairing,
acceptance, and resource reclamation. Keep decisions in `ADR/` and align
`architect.md`, `goal.md`, and `project_state.md` when their content changes.

Reusable role prompts and skills must remain task-agnostic unless the contract
explicitly makes them task-scoped. Task-specific instructions belong in the
frozen contract or task artifacts, not in a reusable skill. The Lead owns the
final check for contamination before acceptance.

## Tool-change completion rule

Whenever a role-visible tool, its input/output contract, its runtime wrapper,
or its availability changes, update the complete tool contract in the same
change: registration and load order, role allowlists and role-card guidance,
tool/skill documentation, runtime policy or wrapper behavior, and focused
tests. Include current OS metadata in the launch-time tool guidance rather
than assuming a POSIX shell or hard-coding a host. Restart every active role
for the task after deployment; mixed tool contracts are unsupported. Do not
accept a tool change until a live smoke exercises the changed path.

Write a tracked Markdown v2 task contract with exactly one JSON contract block.
Each done criterion has a stable `C-###` ID, owner, and artifact path; each
role delegation declares its stable ID, artifact path, and capabilities as
task context. Do not compare those declarations against a static capability
allow-list; actual tool access is enforced by the role launcher and runtime
policy, which may evolve independently of task contracts.
Keep the Blackboard task name and description aligned with the current
Lead-owned contract. Blackboard events are observations and reminders, not
authorization, completion evidence, or a communication channel.

## Issue preflight and proposal gate

Before creating or starting a code task for a GitHub issue, run:

```powershell
<project-root>\pi-team.cmd preflight <issue-number> [<proposal-path>]
```

The preflight must verify that the issue exists, inspect its open/closed state,
record the current `develop` revision, and produce a redacted
`plans/ISSUE-<number>-proposal.md`. The Lead must then verify the reported
behavior or current evidence on `develop`; GitHub state alone is not proof that
an issue is still real.

Do not start a task when the issue is missing, already fixed, stale, or cannot
be fact-checked. Record the reason in the proposal and ask the User when the
result is ambiguous. Issues that conflict with an ADR, require a new ADR,
change product/security/compatibility behavior, or require an irreversible
decision require explicit User review before `publish`/`start`. A bounded fix
that is reproducible and consistent with the existing ADR may proceed after the
proposal is recorded; the proposal is still required for every issue.

## Publish and explicitly start

1. Run `<project-root>\pi-team.cmd publish <absolute-contract-path>`. This is
   the stable, canonical publication path: it creates the matching active task
   or aligns its Lead-owned name and description with the current contract.
2. Run `<project-root>\pi-team.cmd validate <absolute-contract-path>`.
3. Run `<project-root>\pi-team.cmd start <absolute-contract-path>` explicitly.
   This manual command starts the persistent Executor-Reviewer pair; publishing
   the Blackboard lane alone never starts either role.
4. For explicit continuous supervision, retain the Blackboard cursor and call
   `blackboard_watch` for new Agent activity. Compare each activity with the
   current task description. Use the Blackboard event, the supervisor path, or
   paired intercom for correction.
5. Register the current Codex Lead thread with `blackboard_register_lead` after
   `start`. Critical Agent states are delivered by the host wakeup adapter as
   concise follow-up prompts; acknowledge them only after the host creates the
   new Lead turn. Unregister after acceptance or reclamation.

If the Agent Blackboard MCP tools are unavailable, publication and launch may
still proceed through the canonical `pi-team.cmd` commands. Tell the user that
the live task-lane UI and update reminders are unavailable in this session,
inspect `/mcp`, and use the MCP server's Restart control when available. Never
simulate an MCP call by editing common-dir state directly. For this local stdio
server, `/mcp` may show authentication as unsupported; that is expected and is
not a connection error. If the server is absent rather than merely stopped, run
`<project-root>\pi-team.cmd codex-setup` once to register its stable user-level
entry, then restart the Codex session.

For a bounded question, write the Researcher question file and run:

```powershell
<project-root>\pi-team.cmd research <task-id> <question-id> <absolute-question-file>
```

Researcher answers the specific question and maintains `research/`. Executor
maintains `implementation_notes/`. Reviewer writes tests, reviews code, and
uses `failures/` only for real failures.

## Supervise the persistent pair

Executor and Reviewer communicate directly as the Lead-assigned pair and stay
alive through implementation, review, fixes, and re-review. A completed turn
means the role reports its slice and becomes idle/event-driven. Do not stop and
resume roles for normal handoff, and do not reclaim either role early.

Use `blackboard_snapshot`, `blackboard_watch`, or `blackboard_render` to inspect
activity. An activity event, including `ready_for_acceptance`, is a prompt to
inspect evidence; it is never sufficient proof by itself.

When a Codex heartbeat performs a periodic check, call `blackboard_snapshot`
with the cursor returned by the previous heartbeat. Inspect only its
`changes`; the first call establishes a baseline from active tasks, and an
empty `changes` list ends the heartbeat turn. Heartbeat changes are limited to
`blocked`, `changes_requested`, `ready_for_review`, `ready_for_acceptance`, and
`completed`. If changes exist, read the current contract, diff, and artifacts
and continue the ordinary Lead acceptance or supervision flow. Keep the new
cursor, and retry with the old cursor if the heartbeat fails. This is
at-least-once observation: duplicate changes are safe. Heartbeat polling does
not depend on `blackboard_watch`, Lead thread binding, App Server, or a wakeup
bridge.

## Accept and close

After Reviewer reports `ready_for_acceptance`, treat the Reviewer result as the
first acceptance gate, then perform an independent Lead acceptance gate. The
Reviewer verifies implementation quality, scope, regressions, and evidence;
the Lead alone verifies the frozen contract and authorizes delivery. Inspect
the actual diff, artifacts, and test results against the contract. As part of
that inspection, review every changed reusable prompt and skill for
task-specific contamination, including task IDs, Issue numbers, task-only
artifact names, worktree or host paths, raw runtime details, and constraints
that apply only to the current task. Reject the slice or request cleanup if
such content was added without an explicit task-scoped contract.

If both gates pass:

1. Write acceptance evidence that covers every frozen criterion ID and its
   required artifacts, then run `<project-root>\pi-team.cmd accept <task-id>
   <acceptance-file>`.
2. Run `<project-root>\pi-team.cmd finalize <task-id>` exactly once as the
   canonical delivery operation. The command verifies the accepted state,
   stages only contract-scoped changes, creates the integration commit,
   merges it into the target branch, runs integration tests, reclaims owned
   role/Terminal processes, removes the task worktree and merged branch,
   synchronizes the GitHub issue, and only then archives the Blackboard task.
3. Treat the finalizer's JSON result as the lifecycle report. Do not manually
   interleave `reclaim`, `cleanup`, Blackboard archive, or GitHub close with
   finalization. A blocked finalizer preserves the remaining evidence and
   requires Lead/user handling of the reported conflict; it is safe to retry.

For unmet criteria, write a closure with the missing criterion IDs and run
`<project-root>\pi-team.cmd close-incomplete <task-id> <closure-file>`, then run
`<project-root>\pi-team.cmd finalize <task-id>` if the incomplete task has no
uncommitted changes and can be safely reclaimed. Use `reconcile` only for
legacy state and with an explicit outcome.
Do not infer live role status solely from the most recent Blackboard event.

During the lifecycle migration, run code-changing issue tasks serially. Do not
clean historical worktrees or branches automatically: first use Doctor to
produce an inventory, then process an explicitly reviewed manifest in batches.
