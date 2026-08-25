# ADR 0003 — Stable Windows Pi Team entrypoint

Status: Accepted
Date: 2026-08-24

The project entrypoint is `pi-team.cmd`, a thin Windows CMD wrapper around
`scripts/pi-team.ps1`. The PowerShell layer owns contract validation, Git
worktrees, lifecycle state, and Windows Terminal process arguments. It starts
the configured Pi role directly; it does not invoke `pi-subagents`,
`runs.run`, Scout, or a second planner.

The active model is fixed in `.pi/settings.json` to `minimax-cn / MiniMax-M3`,
and Pi's shell is fixed to Windows PowerShell. Executor and Reviewer use one
task worktree and persistent session IDs; Researcher is a temporary tab in the
same task scope. Runtime state and append-only per-role events live under
`<git-common-dir>/pi-team/v1/`. Agents report with `report_to_lead`, whose
identity and sequence fields are injected by the launcher.

The launcher injects `PI_TEAM_TASK_ID`, `PI_TEAM_ROLE`, `PI_TEAM_AGENT_ID`,
`PI_TEAM_WORKTREE`, `PI_TEAM_STATE_ROOT`, and `PI_TEAM_SCOPE_ID` into every
role process. `start` takes the persisted Executor/Reviewer identities,
`resume` reuses those identities and session IDs, and `research` creates one
temporary Researcher identity while retaining the task, worktree, scope, and
common-directory state root. `PI_TEAM_STATE_ROOT` is therefore an internal
launcher-to-extension interface, not a task-contract field.

Because a Git worktree's root `.git` can be a pointer file, the launcher must
resolve `git rev-parse --git-common-dir` before creating or passing the state
root. Paths under `<worktree>/.git/...` are invalid for this purpose.

Pinned Pi packages are installed once at user scope by `pi-team setup`, as
specified by ADR 0004. `start`, `research`, and `resume` verify that shared
installation before launching; `doctor` reports the same state without making
changes. Task worktrees never install project-local Pi packages.

Only Reviewer `ready_for_acceptance` permits acceptance. Reclamation follows
acceptance, and cleanup additionally requires a clean worktree; cleanup never
stashes, force-removes, deletes branches, or touches the main worktree.
