# Pi Team Entrypoint

This repository runs a three-role Pi team from isolated Git worktrees. Codex is
the Lead; Pi supplies the Researcher, Executor, and Validator sessions.

## Module collaboration (v1)

The active path stores long-lived module contracts, pair session records,
debate trace, notifications, summaries, and compaction evidence under the
shared Runtime Store (`<git-common-dir>/pi-team-runtime/v1`). A module permits
one active task and one Executor/Validator pair. Its contract has one current
JSON body with stable `data_flow` and `public_interfaces` keys; Executor alone
can edit it, both roles comment, and both must ACK the complete current body.
The second ACK freezes it. A body change clears ACKs; after 30 submit/comment
actions negotiation pauses for a Lead ruling. Notifications are persisted in
the same locked update as the associated contract event and can be retried by
one dispatcher without counting as a negotiation action.

Validator's source isolation is a prompt requirement, not a sandbox claim.
Lead acceptance remains independent of tests and Blackboard state. Each role
must save its own summary before its compact is recorded; failed compact leaves
the session and task worktree intact for retry.

## Repository workflow

`develop` is the stable integration baseline. Each delegated task owns one
focused branch and one isolated worktree; the task branch is merged back only
after Lead acceptance and review. A worktree is a checkout location, not a
separate source of truth. The canonical `finalize <task-id>` command performs
the reviewed integration and then removes the task worktree and successfully
merged task branch.

Before acceptance, Lead may run `pi-team.cmd inspect <task-id>` to collect a
read-only report covering the contract, actual diff, artifacts, tests, process
ownership, GitHub issue state, and Blackboard observations. Blackboard lag is
reported as a warning and does not replace Lead judgment. Use `--json` for a
machine-readable result, `--skip-tests` only when explicitly appropriate, and
`--output <path>` to persist a sanitized report.

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
The local `develop` branch is the current integration baseline.

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

### Role-specific providers and models

Pi credentials are managed by provider in the user-level `auth.json` (or the
provider environment variables); never put API keys in this repository. The
auth file intentionally contains credentials only (`type`, `key`/`env`, or OAuth
tokens); it has no `baseUrl` field. Built-in providers already carry their
endpoint. For a custom or proxy provider, define its endpoint and API type in
the user-level `models.json` at `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "validator-provider": {
      "baseUrl": "https://api.example.com/v1",
      "api": "openai-completions",
      "models": [{ "id": "validator-model", "name": "Validator model" }]
    }
  }
}
```

Then store only the matching provider credential in `~/.pi/agent/auth.json`
(or provide its environment variable):

```json
{
  "validator-provider": { "type": "api_key", "key": "$VALIDATOR_PROVIDER_API_KEY" }
}
```

Each active role definition declares its runtime selection in frontmatter:

```yaml
provider: minimax-cn
model: MiniMax-M3
```

The launcher reads those fields and passes explicit `--provider` and `--model`
arguments to every Executor, Validator, and Researcher process. The selected
provider/model is frozen in task state so `resume` does not silently switch to
the project default. Use `pi.cmd auth check --provider <provider> --model
<model> --json --no-refresh` to verify credentials without printing them.
The model must support the role's configured tools; `--tools` only controls the
allowlist and does not add tool-calling support to a model.

## Agent Blackboard

The repo-local `agent-blackboard` plugin provides a Lead-owned observability
plane with structured Lead wakeup reminders. Task metadata and append-only
Agent activity events live at
`<git-common-dir>/harness-blackboard/v1/`, shared across the main worktree and
task worktrees. The Lead creates and updates task IDs, names, descriptions, and
lifecycle; Pi roles can only append their own injected-identity activity with
`blackboard_update`.

The Blackboard is not an authorization or communication bus. Use
`blackboard_update` for Lead-facing decisions and correction, and use the
registered Pi Team `pi_team_intercom` tool only for paired peer events.
The plugin supplies MCP tools for task management, snapshots, cursor-based
watching, Lead thread registration, structured wakeup listing/acknowledgement,
and a task-lane UI that requests PiP and falls back inline. For periodic Codex
heartbeat checks, call `blackboard_snapshot` with the previous returned cursor:
it always returns the current active lanes plus only new critical changes
(`blocked`, `changes_requested`, `ready_for_validation`, `ready_for_acceptance`, or
`completed`). The cursor is caller-owned and is not checkpointed by the
Blackboard, so retrying with the prior cursor is safe and may repeat changes.
After `start`, the Lead registers its current Codex `thread_id` and `host_id`.
Only material states (`blocked`, `changes_requested`, `ready_for_validation`,
`ready_for_acceptance`, and `completed`) create wakeups. The host adapter maps
those records to `send_message_to_thread`; it must acknowledge delivery, while
the Lead still performs the normal snapshot, diff, artifact, and contract
checks.
The MCP server and its blackboard core are packaged together inside the plugin;
the installed cache must not depend on a sibling `.pi/blackboard` path.
The plugin also supplies `$pi-team-lead`, which carries this complete launch
and supervision workflow into Codex sessions opened above the repository.

Publishing a Blackboard task only publishes the Lead-owned objective; it does not
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
so agents receive the objective, context, acceptance results, recommended reads,
and validation entrypoints before their first repository exploration. Task-specific
context is generated at runtime and is not added to reusable prompts or skills.

## Formal contract and closure

New task contracts use JSON `version: 3`. A v3 contract contains the task
objective, optional explanatory context, two to five observable acceptance
results, explicit `base_ref`, branch, and worktree fields, and optional
deliverable labels. It does not contain file scope lists, role delegations,
capability declarations, criterion owners, or artifact mappings. Existing v2
contracts are historical material and are not automatically migrated.

`inspect <task-id>` reports the actual diff, tests, artifacts, processes,
Blackboard observations, and reusable-content checks. It does not decide
whether a change is out of scope. The Lead makes that decision after reading
the report, then `accept <task-id> <acceptance-file>` records one decision with
a rationale and optional inspect report reference. A task that cannot be
accepted uses `close-incomplete <task-id> <closure-file>` with a reason and
next step; criterion IDs and artifact mappings are not required.

`reconcile` is limited to legacy state and requires an explicit `accepted` or
`incomplete` outcome; it never infers historic success.
After acceptance, `finalize <task-id>` is the single delivery operation: it
creates the integration commit, merges the task branch, runs the integration
tests, reclaims owned Terminal resources, removes the worktree and merged
branch, synchronizes the GitHub issue, and archives Blackboard only after those
steps succeed. A blocked finalizer preserves the task evidence and returns a
retryable JSON status.

Before a GitHub issue becomes a task, `preflight <issue-number>` creates a
redacted proposal and records the issue state and current `develop` revision.
The Lead must still verify the behavior on `develop`; issue state alone is not
proof that a defect remains.

The plugin's MCP server is local stdio and has no authentication flow, so
`/mcp` may label authentication as unsupported. That label is expected. A
connected server must still become ready and expose its tools; if it does not,
the stable `publish`, `validate`, and `start` commands remain available while
live watching and the task-lane UI are unavailable.

## Runtime identity and state

The launcher injects the complete runtime identity for every Executor,
Validator, and Researcher process: `PI_TEAM_TASK_ID`, `PI_TEAM_ROLE`,
`PI_TEAM_AGENT_ID`, `PI_TEAM_WORKTREE`, `PI_TEAM_STATE_ROOT`, and
`PI_TEAM_SCOPE_ID`. `start` uses the persisted Executor/Validator identities,
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
Validator neither load its provider nor allowlist its tools.

See `ADR/0002-lead-subagent-collaboration-protocol.md` for collaboration rules
and `ADR/0003-stable-pi-team-entrypoint.md` for the lifecycle contract.

## Automatic compression and checkpoint resume

The Pi Team compression extension is loaded by every active role. It reads
the project-level runtime configuration at `.pi/team-runtime.json` and
applies the effective role policy (with role-card overrides) at session
start.

The defaults are:

| Field | Default | Range |
| --- | --- | --- |
| `compression.threshold_percent` | `0.5` | `(0, 1]` |
| `compression.max_tool_calls_per_segment` | `0` (disabled) | `[0, 1000]` |
| `compression.max_compact_retries` | `1` | `[0, 5]` |
| `compression.output_token_limit` | `65536` | `[1024, 1048576]` |

Role overrides are validated against the same ranges and may only be set on
the three active roles (`researcher`, `executor`, `validator`). Sensitive
fields (`api_key`, `token`, `auth`, `password`, `secret`) and host-absolute
paths are rejected at load time. The `output_token_limit` keeps the
existing 64K output budget effective.

Behavior:

- After every agent turn, the extension reads `ctx.getContextUsage()`. When
  the usage percentage crosses the configured threshold and a retry budget
  remains, it triggers `ctx.compact()` with a custom instruction that
  preserves the frozen contract, the latest artifact paths, and the open
  implementation decisions.
- A per-segment tool-call counter can enforce `max_tool_calls_per_segment` when
  set to a positive integer. The default `0` disables this cap. A successful
  `session_compact` resets the counter; a `session_before_compact` event checks
  the retry budget and refuses further retries when that cap is reached.
- When a limit stops the role, the extension writes a credential-free,
  versioned checkpoint to `<state_root>/checkpoints/task-checkpoint-<task>-<role>-<iso>.json`
  and persists the stop reason, frozen policy, stats, and checkpoint path
  into the task state at `<state_root>/<task_id>.json`.

Checkpoints never contain API keys, OAuth tokens, or the previous session
transcript. They carry:

- the frozen compression policy,
- the frozen provider/model,
- the resource-limit stop reason and stats,
- the contract snapshot path,
- the worktree-relative `injected_artifacts` list the resume command must
  inject.

Resource-limit stops never auto-create a new session. Lead must explicitly
resume from the checkpoint:

```powershell
.\pi-team.cmd resume-checkpoint <task-id> <checkpoint-path> <executor|validator>
```

The command mints a fresh session ID, reuses the frozen provider/model
captured in the task state, and injects only the contract snapshot, the
checkpoint summary, and the listed worktree-relative artifacts. The old
session ID is recorded as `previous_session_id` for traceability.

Inspect the most recent checkpoint path without launching a session:

```powershell
Get-Content <state_root>\<task-id>.json | Select-String last_checkpoint_path
```

## Lead-owned project documents

`ADR/0002-lead-subagent-collaboration-protocol.md` is the normative
collaboration contract. `architect.md`, `goal.md`, and `project_state.md` are
Lead-owned summaries and must be realigned when architecture, operational
goals, or project state changes; they are snapshots, not runtime logs. Task
findings and defects belong in the task's GitHub Issue or review evidence once
that repository integration is available.
