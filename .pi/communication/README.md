# Minimal-loop communication policy

This directory implements the runtime policy for `minimal-loop-v1`.
Codex is the user-facing Lead. The only active Pi roles are Researcher,
Executor, and Reviewer.

Lifecycle, authority, and acceptance are normative only in
`ADR/0002-lead-subagent-collaboration-protocol.md`.

## Allowed routes

Direct peer messages are asynchronous and restricted to:

- Researcher <-> Executor
- Executor <-> Reviewer

Researcher and Reviewer cannot communicate directly. Lead does not use
the ordinary peer-send route. Lead assigns each Executor/Reviewer pair; the
role-level ACL does not prove that two allowed sessions belong to the
same task.

For acceptance failures, the Lead-only `pi_team_lead_request_changes` tool
is the supported control route to the current same-task Executor. It accepts
only the structured `LEAD_REQUEST_CHANGES` event, resolves exactly one
`pi-team--<task-id>--executor--<launch-id>` session, publishes through the
same intercom extension bus, and records explicit `not-sent`, `accepted`, or
confirmation-timeout results in the Lead audit file. The Executor projects
the event only after normal inbound policy validation and returns an
accepted/refused confirmation. Lead feedback is therefore a control event,
not an arbitrary text message and not a Blackboard write.

The paired Executor and Reviewer remain alive through implementation,
review/fix, and re-review. `READY_FOR_REVIEW`, `REVIEW_PASS`,
`REVIEW_FAIL`, and `FIX_READY` are asynchronous events. After processing
an event, the role reports its completed slice to Lead and becomes idle;
normal handoff does not stop or resume the sessions.

## Bounded Executor -> Researcher delegation (Issue #3)

The paired Executor may ask the paired Researcher for one bounded,
same-task research slice. This is a peer capability, not a transfer of
Lead authority: the Lead owns the frozen objective and scope, observes
material updates through `blackboard_update`, and makes the final
acceptance or rejection decision.

Before transport, the runtime authorizes the request against the frozen
task state. The request must use the current task ID and an allowed
delegation ID, target the Researcher role, request only capabilities the
Researcher has, and name a research artifact under
`research/<task-id>-<topic-slug>.md`. The artifact path is the ownership
boundary: Researcher writes the artifact, uses a unique human-readable
slug, and must not overwrite another request's artifact unless explicitly
instructed.

The request event is `RESEARCH_REQUEST` and carries the objective,
allowed paths, artifact path, required capabilities, decision-supported
flag, and frozen contract version. A successful `RESEARCH_RESULT` carries
the artifact path, headline, sourced findings with confidence, overall
confidence, and decision impact. A `RESEARCH_BLOCKED` result carries the
same correlation fields plus a reason and detail. Architectural,
out-of-scope, and under-specified requests must also state the next
decision needed from Lead. Requests that widen scope, require unavailable
capabilities, or target a busy/completed pairing are refused or escalated;
they are not silently converted into implementation work.

Researcher returns to waiting/idle after the bounded response. Transport,
audit, or a successfully written artifact is evidence of communication,
not proof of task completion. The Lead must still inspect the reported
decision impact and accept the task only through the normal acceptance
contract.

Each active role loads `blackboard-update.ts`; `report_to_lead` is not
registered. `blackboard_update` records explicit Agent activity in the
Lead-owned common-dir Blackboard. `blocked`, `changes_requested`,
`ready_for_review`, `ready_for_acceptance`, and `completed` enqueue a Lead
wakeup when the task has a Lead binding. It does not authorize work, prove
completion, or replace peer communication.

`sendWithPolicy` in `send.mjs` applies the outbound gate. Each active
agent loads its matching extension from `extensions/`. The extension
blocks disallowed peer sends and blocks peer `ask`, `reply`, and
`cancel`; discovery/status actions remain available.

`PolicyReceiver` and `createRoleRuntimePolicy` apply the inbound gate
before an intercom entry reaches model context. Sender identity comes
from transport metadata rather than message text. An unauthorized or invalid
entry is removed without aborting the legitimate run and without reading or
writing the reply store. An authorized entry is replaced by a `pi_team_event`
whose content is the validated JSON event; the raw envelope, `body_encoding`,
and base64url body are never present in model context. Completed reply replay
remains available through `receiveAndReplay`; `onContext` does not create eager
pending reservations.

Routine peer results need not be relayed through Lead. Material risk, changed
downstream assumptions, and decision requests are published through
`blackboard_update`; use `blocked` whenever a Lead decision or intervention is
needed.

Messages use the structured `agent-team/v1` envelope. Roles do not construct
that envelope: they submit a JSON event with `type` and `task_id` to a peer
role name, while runtime resolves the current same-task session and generates
the UUIDs, canonical envelope, and base64url body. UUIDs are internal transport
correlation identifiers; application artifacts use Lead task IDs and no
application-level content hash. Raw envelopes, session IDs, and launch IDs are
rejected before transport; all active roles must use the same structured-send
version.

## Audit surface (Issue #11)

The audit row written by `appendPolicyAudit` carries the structured
envelope fields (`kind`, `subject`, `references`, `body_summary`
≤80 UTF-8 chars, `body_fingerprint` 16 hex chars, `body_length`) for
**accepted** inbounds and **allowed** outbounds. The base64 wire body
never appears in any audit row, regardless of outcome. For **refused**
events (outbound or inbound), no envelope-derived field is serialized;
the row carries only the structured denial surface (`direction`,
`action`, `recipient`, `outcome`, `reason`, `sender`, `messageId`,
`correlationId`, `trace`). This prevents unauthorized senders' body
bytes from leaking into the audit even when the runtime has parsed the
envelope for ACL evaluation. The audit shape is the source-of-truth
for Lead retrospection; `formatAuditEvent` in
`.pi/communication/policy.mjs` is the only writer.

## Stale-session recovery (Issue #11)

Each structured send resolves the current same-task peer role from the
intercom extension channel immediately before transport. Roles never cache or
provide a session or launch ID. Missing or ambiguous peers, cross-task targets,
wrong roles, malformed JSON events, and raw envelopes are refused before
transport without exposing the resolved session identifier.

## Evidence boundary

Run `powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1` on
Windows, or run both Node test files directly. These tests establish the
policy contract, denial side effects, and extension wiring. They do not
establish causal transport capability merely because an extension was
loaded or an audit event exists. A live Executor/Reviewer exchange must
be reported separately as an operational smoke test.

The legacy v2.1 roles and Deep Research implementation are archived
under `.pi/legacy/` and are not part of this active policy.
