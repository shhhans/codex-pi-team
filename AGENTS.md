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
