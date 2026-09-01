# Pi Team Entrypoint

This repository runs a three-role Pi team from isolated Git worktrees. Codex is
the Lead; Pi supplies the Researcher, Executor, and Reviewer sessions.

## Repository workflow

`master` is the stable integration baseline. Each delegated task owns one
focused branch and one isolated worktree; the task branch is merged back only
after Lead acceptance and review. A worktree is a checkout location, not a
separate source of truth, and cleanup removes the worktree but does not delete
its branch.

When a task discovers an unrelated defect, the Agent reports it to Lead and the
current task remains within its frozen scope. Once this repository has a
configured GitHub remote and verified Issue permissions, Lead records the
defect in GitHub Issues rather than creating an `issues/` ledger in the main
worktree. A code fix receives a separate `fix/issue-<number>-<slug>` task,
branch, worktree, review, and merge. Runtime reports, temporary prompts,
hand-built envelopes, and audit records stay outside Git or in the configured
runtime/archive store; GitHub Issues receive only concise, sanitized evidence.

Every new task must use an explicit clean `base_ref`. Until the launcher
enforces that field during branch creation, Lead must pre-create the task
branch from the exact ref or stop on a mismatch; starting from whichever
branch happens to be checked out is not a valid substitute.

The project is published at
[github.com/shhhans/codex-pi-team](https://github.com/shhhans/codex-pi-team).
The local `master` branch is the current pushed baseline.

## First-time setup

Install the pinned Pi packages once in Pi's user package directory:

```powershell
.\pi-team.cmd setup
```

The command installs `pi-subagents@0.56.0`, `pi-intercom@0.11.0`, and
`pi-web-access@0.24.2` under `~/.pi/agent/npm/`. It is safe to run again and
preserves unrelated Pi user settings and packages. Project worktrees do not
contain or install their own copies.

Check the environment without changing it:

```powershell
.\pi-team.cmd doctor
```

Register the Blackboard MCP as a stable user-level Codex stdio server once per
machine (the plugin continues to provide its skills and UI):

```powershell
.\pi-team.cmd codex-setup
```

This command uses the supported `codex mcp add` interface and resolves the
server's absolute path from this checkout. It can be rerun after moving the
repository.

`start`, `research`, and `resume` fail before launching a Pi session when the
shared packages are missing, have the wrong version, or Web Access is globally
autoloaded.

## Agent Blackboard

The repo-local `agent-blackboard` plugin provides a Lead-owned observability
plane with structured Lead wakeup reminders. Task metadata and append-only
Agent activity events live at
`<git-common-dir>/harness-blackboard/v1/`, shared across the main worktree and
task worktrees. The Lead creates and updates task IDs, names, descriptions, and
lifecycle; Pi roles can only append their own injected-identity activity with
`blackboard_update`.

The Blackboard is not an authorization or communication bus. Use the existing
`report_to_lead`, supervisor, and intercom paths for decisions and correction.
The plugin supplies MCP tools for task management, snapshots, cursor-based
watching, Lead thread registration, structured wakeup listing/acknowledgement,
and a task-lane UI that requests PiP and falls back inline. For periodic Codex
heartbeat checks, call `blackboard_snapshot` with the previous returned cursor:
it always returns the current active lanes plus only new critical changes
(`blocked`, `changes_requested`, `ready_for_review`, `ready_for_acceptance`, or
`completed`). The cursor is caller-owned and is not checkpointed by the
Blackboard, so retrying with the prior cursor is safe and may repeat changes.
After `start`, the Lead registers its current Codex `thread_id` and `host_id`.
Only material states (`blocked`, `changes_requested`, `ready_for_review`,
`ready_for_acceptance`, and `completed`) create wakeups. The host adapter maps
those records to `send_message_to_thread`; it must acknowledge delivery, while
the Lead still performs the normal snapshot, diff, artifact, and contract
checks.
The MCP server and its blackboard core are packaged together inside the plugin;
the installed cache must not depend on a sibling `.pi/blackboard` path.
The plugin also supplies `$pi-team-lead`, which carries this complete launch
and supervision workflow into Codex sessions opened above the repository.

Publishing a Blackboard task only publishes the Lead-owned scope; it does not
start Pi roles. The Lead uses the stable entrypoint for publication and then
explicitly launches the pair:

```powershell
.\pi-team.cmd publish .\plans\<task-id>-task.md
.\pi-team.cmd validate .\plans\<task-id>-task.md
.\pi-team.cmd start .\plans\<task-id>-task.md
```

`publish` creates the matching active task or aligns its Lead-owned name and
description with the current contract. `start` checks that the matching
Blackboard task already exists and is active.
It snapshots the formal contract under the shared Pi Team state root, binds
stable Pi session IDs, disables ambient extensions and skills, and loads only
the role's explicit tools, private skill, and extensions. The Lead then watches
Blackboard events; Agent events never replace review or acceptance.

Active roles inherit the stable shared context from `AGENTS.md`. The launcher
adds a compact role-specific task context at `start`, `research`, and `resume`
so agents receive the relevant scope, artifact paths, recommended reads, and
validation entrypoints before their first repository exploration. Task-specific
context is generated at runtime and is not added to reusable prompts or skills.

## Formal contract and closure

New task contracts use JSON `version: 2`. Each `done_criteria` entry has a
stable `C-###` ID, owner role, description, and worktree-relative artifact
path. `delegations` name the assigned role, stable delegation ID, objective,
artifact path, and required capabilities. The launcher validates those
capabilities before launch; Researcher delegations needing shell or profiler
access are rejected before a Researcher is started.

`accept <task-id> <acceptance-file>` requires a Reviewer
`ready_for_acceptance` event and one evidence entry for every frozen criterion
ID, including its required artifacts. A task that cannot meet every criterion
uses `close-incomplete <task-id> <closure-file>`; it records a reason and the
missing criterion IDs, synchronizes the Blackboard as `incomplete`, and may
then be reclaimed. `reconcile` is limited to legacy state and requires an
explicit `accepted` or `incomplete` outcome; it never infers historic success.

The plugin's MCP server is local stdio and has no authentication flow, so
`/mcp` may label authentication as unsupported. That label is expected. A
connected server must still become ready and expose its tools; if it does not,
the stable `publish`, `validate`, and `start` commands remain available while
live watching and the task-lane UI are unavailable.

## Runtime identity and state

The launcher injects the complete runtime identity for every Executor,
Reviewer, and Researcher process: `PI_TEAM_TASK_ID`, `PI_TEAM_ROLE`,
`PI_TEAM_AGENT_ID`, `PI_TEAM_WORKTREE`, `PI_TEAM_STATE_ROOT`, and
`PI_TEAM_SCOPE_ID`. `start` uses the persisted Executor/Reviewer identities,
`resume` reuses those identities and session IDs, and `research` creates a
temporary Researcher identity for the same task scope.

`PI_TEAM_STATE_ROOT` is always `<git-common-dir>/pi-team/v1`. A worktree's
`.git` entry may be a pointer file rather than a directory, so callers must
never construct state paths by appending to `<worktree>/.git`; the launcher
resolves Git's common directory and validates that the state root is a
directory before starting a process.

## Extension isolation

All three role definitions disable ambient extensions and load their required
extensions explicitly. Only Researcher loads `pi-web-access`; Executor and
Reviewer neither load its provider nor allowlist its tools.

See `ADR/0002-lead-subagent-collaboration-protocol.md` for collaboration rules
and `ADR/0003-stable-pi-team-entrypoint.md` for the lifecycle contract.

## Lead-owned project documents

`ADR/0002-lead-subagent-collaboration-protocol.md` is the normative
collaboration contract. `architect.md`, `goal.md`, and `project_state.md` are
Lead-owned summaries and must be realigned when architecture, operational
goals, or project state changes; they are snapshots, not runtime logs. Task
findings and defects belong in the task's GitHub Issue or review evidence once
that repository integration is available.
