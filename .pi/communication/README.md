# Agent-team communication policy

This is the project-level policy layer for Architecture v2.1. Codex is the sole Lead; Pi is only the execution and communication bridge. The default route is Agent → Lead → Agent. Direct peer policy is limited to Researcher ↔ Architect and Architect ↔ Critic. Reviewer routes through Lead.

The bounded-peer rule is enforced by role prompts and Lead audit. It is not an intercom transport ACL: the generic local bus can address any visible session, so a compliant Agent must refuse before calling `intercom` for a disallowed peer.

The concrete outbound gate is `sendWithPolicy` in `send.mjs`; it records an audit event and does not invoke the client for a disallowed pair. Each role loads a project extension from `communication/extensions/`. Its `tool_call` hook runs that gate before an `intercom send` reaches the transport, permits only canonical bounded-peer role names, and blocks peer `ask`, `reply`, and `cancel`. Discovery/status actions remain available. Critic and Reviewer supervisor calls are restricted to `reason: "need_decision"`.

The concrete inbound gate is `PolicyReceiver`. The role extension applies it in Pi's `context` event, before a provider request and before any Agent tool call. It validates only structured `intercom_message` entries and uses the transport-provided `details.from` and `details.bodyText`; user text that imitates an intercom header is not trusted. Rejected entries are removed from model context without calling `ctx.abort()`, so an illegal message cannot interrupt an in-flight legitimate task. This guarantees zero model/business-tool side effects from the rejected entry, not zero transport/session side effects. Runtime audit metadata is appended under `communication/audit/`; message bodies and hashes are not recorded. These are Agent/runtime policy gates layered above the generic intercom bus, not transport security.

The context hook also reserves each accepted logical UUID in the persistent reply store. A retry with a completed record receives a replay entry containing the original reply; a retry with a pending record is removed without reprocessing. The store is enabled by default under `communication/reply-store/` and can be redirected with `HARNESS_REPLY_STORE_DIR`.

Messages use the text convention implemented in `policy.mjs`: one UUID per logical request, reused for retries; correlation is explicit; deduplication is `(UUID, recipient)` for one hour; no application-layer hash is used. `send` is asynchronous and does not wait for a reply. Invalid, expired, duplicate, unauthorized, or malformed messages are rejected without side effects.

Scope changes mark the old run stale, preserve valid partial artifacts, and start a new run under a new plan version. `intercom cancel` only cancels a sent message and is never treated as subagent-task cancellation. If Critic is unavailable, continue only with `unverified-architecture`; security-sensitive, irreversible, publishing, deployment, external-user, billing, secret, and remote-infrastructure actions remain blocked.

Run the empirical checks with `powershell -File tests/run-tests.ps1`. A test that depends on intercom must fail or defer when intercom is disabled or its policy is removed; passing the policy unit tests alone is not evidence of transport causality.
