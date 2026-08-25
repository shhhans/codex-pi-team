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

## Own the task as Lead

The User and Lead own architecture and product decisions. The Lead owns the
task ID, name, description, scope, done criteria, Executor-Reviewer pairing,
acceptance, and resource reclamation. Keep decisions in `ADR/` and align
`architect.md`, `goal.md`, and `project_state.md` when their content changes.

Write a tracked Markdown task contract with exactly one JSON contract block.
Keep the Blackboard task name and description aligned with the current
Lead-owned contract. Blackboard events are observations and reminders, not
authorization, completion evidence, or a communication channel.

## Publish and explicitly start

1. Run `<project-root>\pi-team.cmd publish <absolute-contract-path>`. This is
   the stable, canonical publication path: it creates the matching active task
   or aligns its Lead-owned name and description with the current contract.
2. Run `<project-root>\pi-team.cmd validate <absolute-contract-path>`.
3. Run `<project-root>\pi-team.cmd start <absolute-contract-path>` explicitly.
   This manual command starts the persistent Executor-Reviewer pair; publishing
   the Blackboard lane alone never starts either role.
4. Retain the Blackboard cursor and call `blackboard_watch` for new Agent
   activity. Compare each activity with the current task description. Use
   `report_to_lead`, the supervisor path, or paired intercom for correction.

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

## Accept and close

After Reviewer reports `ready_for_acceptance`, inspect the actual diff,
artifacts, and test results against the contract. If they pass:

1. Run `<project-root>\pi-team.cmd accept <task-id>`.
2. Run `<project-root>\pi-team.cmd reclaim <task-id>`.
3. Use `blackboard_accept_task`, then `blackboard_archive_task` after resources
   are reclaimed.
4. Run `<project-root>\pi-team.cmd cleanup <task-id>` only when the reclaimed
   worktree is clean and its committed work has been preserved as intended.

Report any unmet criterion as incomplete. Do not infer live role status solely
from the most recent Blackboard event.
