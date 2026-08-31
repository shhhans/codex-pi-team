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
the peer-send route. Lead assigns each Executor/Reviewer pair; the
role-level ACL does not prove that two allowed sessions belong to the
same task.

The paired Executor and Reviewer remain alive through implementation,
review/fix, and re-review. `READY_FOR_REVIEW`, `REVIEW_PASS`,
`REVIEW_FAIL`, and `FIX_READY` are asynchronous events. After processing
an event, the role reports its completed slice to Lead and becomes idle;
normal handoff does not stop or resume the sessions.

Each active role also loads `blackboard-update.ts`. `blackboard_update` records
explicit Agent activity in the Lead-owned common-dir Blackboard, but it does
not authorize work, prove completion, or replace this communication path.

`sendWithPolicy` in `send.mjs` applies the outbound gate. Each active
agent loads its matching extension from `extensions/`. The extension
blocks disallowed peer sends and blocks peer `ask`, `reply`, and
`cancel`; discovery/status actions remain available.

`PolicyReceiver` and `createRoleRuntimePolicy` apply the inbound gate
before an intercom entry reaches model context. Sender identity comes
from transport metadata rather than message text. An unauthorized entry
is removed without aborting the legitimate run and without reading or
writing the reply store. An authorized entry is retained. Completed
reply replay remains available through `receiveAndReplay`; `onContext`
does not create eager pending reservations.

All three active roles may contact Lead only with the closed reason set:
`need_decision`, `progress_update`, and `interview_request`. Routine peer
results need not be relayed through Lead, but material risk, changed
downstream assumptions, and decision requests must be mirrored.

Messages use the structured `agent-team/v1` envelope. UUIDs are internal
transport correlation identifiers; application artifacts use Lead task
IDs and no application-level content hash.

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

When a same-task paired peer (`pi-team--<task-id>--<role>--<launch-id>`)
becomes unreachable, `sendWithPolicy` classifies the transport failure
against a conservative sentinel list (`no-such-session`,
`session-not-found`, `disconnected`, `not-delivered`, `no-such-target`)
and the runtime surfaces a typed diagnostic with the recovery hint:
"call `intercom list-cwd` and re-send to the current same-task paired
role peer". The runtime never silently redelivers to a different task
or a different role; cross-task rediscovery returns `peer_wrong_task`,
cross-role rediscovery returns `peer_wrong_role`, and unauthorized
senders / malformed envelopes keep their existing ACL / wire-shape
refusal surfaces. The agent prompt and skills describe the four typed
failures and the recovery path.

## Evidence boundary

Run `powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1` on
Windows, or run both Node test files directly. These tests establish the
policy contract, denial side effects, and extension wiring. They do not
establish causal transport capability merely because an extension was
loaded or an audit event exists. A live Executor/Reviewer exchange must
be reported separately as an operational smoke test.

The legacy v2.1 roles and Deep Research implementation are archived
under `.pi/legacy/` and are not part of this active policy.
