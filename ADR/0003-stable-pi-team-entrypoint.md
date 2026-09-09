# ADR 0003 — Stable Windows Pi Team entrypoint

Status: Accepted
Date: 2026-08-24

The project entrypoint is `pi-team.cmd`, a thin Windows CMD wrapper around
`scripts/pi-team.ps1`. The PowerShell layer owns contract validation, Git
worktrees, lifecycle state, and Windows Terminal process arguments. It starts
the configured Pi role directly; it does not invoke `pi-subagents`,
`runs.run`, Scout, or a second planner.

`codex-setup` registers the packaged Blackboard server through the supported
`codex mcp add` command as a user-level stdio MCP entry. This avoids relying on
plugin lazy-loading order, and can be rerun if the repository moves.

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

The direct Pi CLI has no `--agent` option. The launcher translates each role
definition into explicit CLI arguments: `--no-extensions`, `--no-skills`, one
strict `--tools` allowlist, one private `--skill`, and only the named role
extensions. This prevents user-level `pi-subagents` and `runs.run` from entering
a role session. The first Executor/Reviewer launch binds the persisted identity
with `--session-id`; later launches select it with `--session`.

Role runtime files are loaded from the canonical project root, not from the
task branch snapshot. `publish` validates the formal task contract and uses the
packaged Blackboard core to create or align its active Lead-owned task without
depending on Codex MCP tool discovery. Before work begins, `start` requires the
Lead-owned Blackboard task to exist and be active, then freezes the formal task
contract
under `<git-common-dir>/pi-team/v1/contracts/` and injects that exact path into
both roles. Publishing a Blackboard task remains separate from manually invoking
`pi-team.cmd start`; neither action implies the other.

Because a Git worktree's root `.git` can be a pointer file, the launcher must
resolve `git rev-parse --git-common-dir` before creating or passing the state
root. Paths under `<worktree>/.git/...` are invalid for this purpose.

Pinned Pi packages are installed once at user scope by `pi-team setup`, as
specified by ADR 0004. `start`, `research`, and `resume` verify that shared
installation before launching; `doctor` reports the same state without making
changes. Task worktrees never install project-local Pi packages.

Reviewer `ready_for_acceptance` is evidence, not the Lead's decision. Before
acceptance, Lead runs the read-only `inspect <task-id>` command for a unified
evidence report, decides whether the objective and acceptance results are met,
and records one acceptance decision. A partial task is closed explicitly as
`incomplete`, with a reason and next step. The Lead then invokes the
deterministic finalizer, which integrates the accepted task worktree changes,
reclaims task-owned Terminal resources, removes the task worktree and merged
branch, synchronizes GitHub, and attempts Blackboard archival. Blackboard
convergence is reported but is not a finalizer gate.
Conflicts or failed tests preserve the remaining task evidence for retry; the
finalizer never touches the main worktree as a cleanup target.
