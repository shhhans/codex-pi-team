# Minimal-loop communication policy

This directory implements the runtime policy for `minimal-loop-v1`.
Codex is the user-facing Lead. The only active Pi roles are Researcher,
Executor, and Reviewer.

## Allowed routes

Direct peer messages are asynchronous and restricted to:

- Researcher <-> Executor
- Executor <-> Reviewer

Researcher and Reviewer cannot communicate directly. Lead does not use
the peer-send route. Lead assigns each Executor/Reviewer pair; the
role-level ACL does not prove that two allowed sessions belong to the
same task.

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

## Evidence boundary

Run `powershell -ExecutionPolicy Bypass -File tests/run-tests.ps1` on
Windows, or run both Node test files directly. These tests establish the
policy contract, denial side effects, and extension wiring. They do not
establish causal transport capability merely because an extension was
loaded or an audit event exists. A live Executor/Reviewer exchange must
be reported separately as an operational smoke test.

The legacy v2.1 roles and Deep Research implementation are archived
under `.pi/legacy/` and are not part of this active policy.
