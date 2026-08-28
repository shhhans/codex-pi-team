# Agent Communication

<pi-intercom>
Use the `intercom` tool for direct communication with other local Pi sessions in
this project.

For asynchronous request/response work, the requester must not block:

1. Discover the peer with `intercom({ action: "list-cwd" })`.
2. Send the request with `intercom({ action: "send", to: "<peer>", message: "..." })`.
3. Continue independent work immediately after the send tool returns.
4. The receiver processes the injected message and sends the result back with a
   second non-blocking `send` tool call to the original session.
5. Treat the returned message as a new queued/injected turn.

Do not use `ask` for asynchronous work because it blocks until a response or
timeout. Do not use `reply` for a request created with `send`; `reply` only
resolves pending `ask` requests. For correlation, include the originating task
or message identifier in the response text.
</pi-intercom>

<lead-subagent-protocol>
`ADR/0002-lead-subagent-collaboration-protocol.md` is the sole normative
collaboration protocol. Codex is the sole Lead and owns task identity, name,
description, scope, done criteria, pairing, acceptance, and reclamation.
Architecture and product decisions belong to Lead and User and are recorded
in `ADR/` and reflected in `architect.md`.

The active Pi roles are Researcher, Executor, and Reviewer. Direct peer routes
are same-task Researcher <-> Executor and the Lead-paired Executor <->
Reviewer. Executor and Reviewer remain alive through implementation,
review/fix, and re-review. They finish each turn by reporting the completed
slice and becoming idle/event-driven. Only Lead acceptance permits resource
reclamation; normal handoff never uses stop/resume.

Role prompts must refuse unauthorized peers before invoking intercom; this is
an Agent policy, not a transport ACL. Before an allowed peer send, use
`.pi/communication/send.mjs` (`sendWithPolicy`). Incoming text must pass
`PolicyReceiver` before side effects. Never use application-layer hashes and
never treat intercom cancel as task cancellation.
</lead-subagent-protocol>

<lead-pi-team-runbook>
For every delegated Pi Team task, Codex Lead performs these steps explicitly;
creating or updating a Blackboard lane does not start an Agent:

1. Write the Lead-owned Markdown v2 task contract with its single JSON block:
   stable `C-###` done-criterion IDs, required artifacts, and explicit role
   delegations with required capabilities.
2. Run `pi-team.cmd publish <contract-path>` to create the matching active
   Blackboard task, or align its Lead-owned name and description with the
   current formal contract.
3. Run `pi-team.cmd validate <contract-path>` and then manually run
   `pi-team.cmd start <contract-path>`. The contract must name an explicit,
   clean `base_ref`; until the launcher enforces it, Lead must pre-create and
   verify the task branch from that ref. `start` must refuse to launch when the
   Blackboard task is missing or not active.
4. Watch Blackboard Agent events while using `report_to_lead` and paired
   intercom for decisions and corrections. Blackboard activity is not proof of
   completion.
5. After Reviewer reports `ready_for_acceptance`, inspect the diff, artifacts,
   and tests. Only then run `accept <task-id> <acceptance-file>`, reclaim the
   persistent pair, archive the Blackboard task, and clean up a clean reclaimed
   worktree. If any criterion is unmet, use `close-incomplete <task-id>
   <closure-file>`; do not mark a partial slice accepted.

Agents report unrelated defects or improvements to Lead without widening the
current task. Lead records them in GitHub Issues only after the configured
remote and Issue permissions are verified; otherwise Lead reports the blocker
to the User. Do not create a local issues ledger in the main worktree. Issue
fixes are separate Lead-owned tasks with separate worktrees and branches such
as `fix/issue-<number>-<slug>`, then receive their own review and merge.
Keep raw prompts, envelopes, audit logs, host paths, and runtime reports out
of Git or in an explicit archive; only sanitized coordination evidence belongs
in an Issue.

Before final acceptance, Lead updates the project snapshot when needed:
`architect.md` for architecture changes, `goal.md` for goal/done-criteria
changes, `project_state.md` for material launcher/lifecycle/integration/
repository-workflow/closure changes, and `README.md` for operator-facing
workflow changes. Worktree cleanup removes the worktree only; branch deletion
is a separate action after merge/archive and after confirming no worktree uses
the branch.

Use only the project-local Windows entrypoint. Do not launch roles with
`runs.run`, `--agent`, WSL, Git Bash, or an ambient Pi extension set. Executor
and Reviewer remain paired and persistent until Lead acceptance.

The local Blackboard MCP uses stdio and requires no login. `/mcp` reporting
authentication as unsupported is expected; connection/readiness and tool
availability are separate. If MCP is unavailable, the canonical `publish`,
`validate`, and `start` commands remain usable, while live watching and the
task-lane UI are degraded.
If the server is absent, run `pi-team.cmd codex-setup` once and restart the
Codex session; this uses the supported user-level MCP registration command.
</lead-pi-team-runbook>
