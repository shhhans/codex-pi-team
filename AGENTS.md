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

<agent-team-v2-1>
Codex is the sole Lead. Pi orchestrates execution and communication only. Default routing is Agent → Lead → Agent; direct peer policy is Researcher ↔ Architect and Architect ↔ Critic only, with Reviewer through Lead. Role prompts must refuse unauthorized peers before invoking intercom; this is not a transport ACL. Use `.pi/communication/policy.mjs` for UUID/correlation/dedup/queue/stale-run conventions. Never use application-layer hashes, and never treat intercom cancel as subagent cancellation.
Before an allowed peer send, use `.pi/communication/send.mjs` (`sendWithPolicy`); it records Lead audit and refuses before the transport call for disallowed peers. Incoming text must pass `PolicyReceiver` before any side effect.
</agent-team-v2-1>
