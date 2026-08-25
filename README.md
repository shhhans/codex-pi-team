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

`start`, `research`, and `resume` fail before launching a Pi session when the
shared packages are missing, have the wrong version, or Web Access is globally
autoloaded.

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
