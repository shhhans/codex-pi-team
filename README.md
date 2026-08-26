# Pi Team Entrypoint

This repository runs a three-role Pi team from isolated Git worktrees. Codex is
the Lead; Pi supplies the Researcher, Executor, and Reviewer sessions.

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
plane. Task metadata and append-only Agent activity events live at
`<git-common-dir>/harness-blackboard/v1/`, shared across the main worktree and
task worktrees. The Lead creates and updates task IDs, names, descriptions, and
lifecycle; Pi roles can only append their own injected-identity activity with
`blackboard_update`.

The Blackboard is not an authorization or communication bus. Use the existing
`report_to_lead`, supervisor, and intercom paths for decisions and correction.
The plugin supplies MCP tools for task management, snapshots, cursor-based
watching, and a task-lane UI that requests PiP and falls back inline.
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
