# Agent Team Communication Architecture v2.1 (surgical superseding revision of v2)

- **Status:** superseding architecture — design proposal, read-only analysis
- **Supersedes:** `.pi/research/agent-team-communication-architecture-v2.md` (v2; preserved verbatim where not affected by the corrections listed below)
- **Governs:** agent-team communication from this version forward
- **Audience:** Lead (= Codex, see §2), User (decision owner)
- **Source of truth for decisions:** `.pi/decisions/2026-08-21-agent-team-communication-baseline.md` (accepted 2026-08-21-01). Every item in that decision is treated as fixed ground truth, not as a menu, throughout this artifact.
- **Decider:** User (via baseline acceptance of 2026-08-21-01) + Architect (this artifact)
- **Consulted:** Researcher (research brief `.pi/research/agent-team-communication-report.md`), Critic (pending review of v2.1)
- **Informed:** Engineer, Reviewer, Critic, Researcher
- **Open-risks:** Non-blocking risk clarifications §14; Blocker 1 and Blocker 2 are corrected inline, not appended

## Changelog versus v2

This v2.1 is a surgical revision addressing two blockers revealed by inspection of the installed `pi-intercom` substrate (`D:\Coding\Harness\.pi\npm\node_modules\pi-intercom\index.ts`, lines 1812-1846 and 1967-1992) plus four non-blocking risk clarifications. v2 is preserved verbatim in every other respect — same headings, same order, same wording — including the accepted baseline, the hub-and-spoke + bounded-peer topology, async non-blocking peer semantics, the package handoff channel, the ask/send distinction, audit-trail expectations, and Lead-Worker bounded pairs as policy. **Blocker 1** corrects v2's claim that `intercom({ action: "cancel", to: "<subagent>" })` cancels subagent tasks; it does not — the cancel action takes a `messageId` and only requests cancellation of a previously SENT intercom message, and the corrected stale-run procedure replaces every "forced stop / hard kill" claim with mark-stale, ignore-stale-results-except-valid-partials, safe-boundary OR empirically-tested process mechanism, and new-run-under-new-plan. **Blocker 2** corrects v2's claim that unauthorized peer pairs are rejected by the intercom bus; `pi-intercom` is a generic local session bus with no pair-level ACL, the bounded-pair rule from the baseline is enforced as AGENT POLICY (role prompts + Lead audit), and the AT-UNAUTH-PAIR acceptance test is replaced by a NEGATIVE-CONTROL TRACE that asserts the Agent refuses before any `send` is observed. Both blockers are inlined with clear headings; no separate fixes appendix is appended. A final "Non-blocking risk clarifications" section covers the four precision fixes (1-hour dedup window distinct from any optional Agent-side role cache; reworded `send` semantics; conditional Codex peer participation; `kind` as our routing/audit convention rather than substrate-defined). No application-level hashes, integrity digests, or new transport/security claims are added.

---

## 1. Scope and supersession statement

### 1.1 What v2 supersedes (from v1)

v2 replaces v1 entirely. The following v1 claims are **removed or corrected** in v2:

| v1 element | v2 disposition | Reason |
|---|---|---|
| `kind: enum: request, reply, progress, decision, scope_change, scope_ack, cancel, throttle, error, heartbeat` | Reduced to `kind: request \| reply \| error` (plus `kind: progress` as non-blocking-only). Scope, cancel, throttle, heartbeat kinds removed — replaced by the scope-change protocol in §6 and by the cancellation/restart protocol in §10 acceptance test AT-CANCEL. | Many of those kinds are speculative; only `request`, `reply`, `error`, and a non-blocking `progress` map to mechanisms actually present in the installed substrate today. |
| `priority: enum: normal, high, blocking` | Reduced to `priority: normal \| high`. `blocking` is removed (baseline correction; not in baseline). | Baseline correction: `priority: blocking` is undocumented and must not appear. |
| `reply_path: enum: live, none` | Removed entirely. | Baseline correction: undocumented. `live` semantics are expressed by `intercom({ action: "ask" })` and `contact_supervisor({ reason: "need_decision" })` at the tool layer, not in the envelope. |
| `idempotency_key: UUIDv4 or deterministic hash of (sender + intent + plan_version)` | Replaced by the single-UUID rule in §5. | Baseline correction: deterministic hashing of mutable inputs causes collisions; the baseline prescribes one UUID per logical request. |
| Mtime-based tamper detection in Phase 2 | Replaced by git history review (§7). | Baseline correction: mtime is trivially forgeable; baseline prescribes git history review. |
| Phase-2 "WORM or cryptographic integrity" claim | Removed. | Baseline correction: must not claim WORM or cryptographic integrity. |
| "Lead is the user-facing Pi session (pi-subagents orchestrator)" | Replaced by §2: **Lead is Codex**. | Baseline correction: per `.pi/decisions/2026-08-21-agent-team-communication-baseline.md` item 1, "Codex is the sole Lead/Captain and the only user-facing decision integrator." |
| v1 §4 scope-change broadcast asserted as a current capability | Downgraded to "designed but unproven" (§8.2). | Baseline correction: baseline item 9 says "Do not assume live parent-to-subagent broadcast exists." |
| v1 §9 Phase 4 "scope_change broadcast" | Removed as a numbered phase; folded into the scope-change protocol (§6) which is itself marked unproven. | Same reason as above. |
| v1 §1 precedence rule "most-recent-writer" tail | Removed. Baseline D-1 may be the chosen precedence once user confirms, but v2 does not adopt `most-recent-writer` as a default. | Baseline correction: "Remove `most-recent-writer` as an authority rule." |
| v1 §6 envelope fields `causation_id`, `expires_at` | Removed. Not needed for the corrected protocol; superseded by git history review and the structured `interview` payload. | Trim to substrate and baseline. |
| v1 §6 `subject`, `body` envelope fields | Kept but reframed as recommended message-text conventions, not as envelope-schema fields. The installed `intercom({ action: "send", message: ... })` accepts a single text field; structured fields beyond `message` are not part of the substrate. | Trim to substrate. |

### 1.2 What v2 (and v2.1) preserves from v1

- Hub-and-spoke by default with bounded peer escape hatches (baseline items 1, 3, 4).
- Per-decision RACI single-A accountability (baseline item 1, plus the corrected precedence rule).
- Async non-blocking request/reply lifecycle based on `intercom({ action: "send" })` and per-session correlation id in message text (AGENTS.md).
- Decision log at `.pi/decisions/<YYYY-MM-DD>-<slug>.md`, append-only, with `supersedes:` on contradictions (baseline).
- Mirror-to-Lead rule (baseline item 7).
- Scope-change handling using mark-stale / cancel / preserve-partial / restart under a new plan version (baseline item 9).
- Six-signal HITL escalation set (confidence breach, action-risk tier, frustration, SLA-approaching, irreversibility, anomaly/injection) as the descriptive trigger taxonomy that informs Lead→User escalation triggers (§3).
- Researcher round-gating via `research_checkpoint` (already in the Researcher agent definition).

### 1.3 What v2.1 does NOT change (baseline is fixed)

- Codex is the sole Lead (§2, baseline item 1).
- Hub-and-spoke by default with the bounded peer pairs in baseline item 4.
- Reviewer→Lead-only during initial rollout (baseline item 5).
- Critic and Reviewer may use `contact_supervisor` only for risk and verdict escalation (baseline item 6) — see §4.2 for the corrected escalation wiring.
- Mirror-to-Lead rule and its immediate-vs-deferred split (baseline item 7).
- One UUID per logical request, reused on retry (baseline item 8; see §5).
- Scope-change protocol (baseline item 9; see §6, with corrected text in **Blocker 1 — Cancellation semantics**).
- Critic-unavailable degraded mode (baseline item 10; see §9).

### 1.4 What v2.1 explicitly does NOT claim

- v2.1 does NOT claim that intercom is currently exposed to any agent role.
- v2.1 does NOT claim that `contact_supervisor` is currently exposed to Critic or Reviewer.
- v2.1 does NOT claim that `intercom({ action: "cancel", ... })` provides subagent task cancellation; that action takes a `messageId` and only requests cancellation of a previously SENT message (see **Blocker 1 — Cancellation semantics**).
- v2.1 does NOT claim that the intercom bus enforces pair-level authorization. Bounded pairs are an Agent policy, not a transport ACL (see **Blocker 2 — Pair-level authorization**).
- v2.1 does NOT claim live parent-to-child broadcast as a current capability.
- v2.1 does NOT claim cryptographic, WORM, or hash-chain tamper detection.
- v2.1 does NOT invent new `contact_supervisor.reason` enum members.

---

## 2. Glossary

| Term | Definition in v2.1 | Notes |
|---|---|---|
| **Lead** | **Codex**, the user-facing session. The only role that communicates directly with the User. | Per baseline item 1. **Not** a Pi subagent. Codex is the parent Pi session in the `pi-subagents` model but the user-facing persona is Codex. |
| **Codex Lead** | Synonym for Lead in this artifact. | Used for clarity when referring to the runtime session identity vs. the role. |
| **User** | The human. Receives ordinary Codex conversation from Lead. Does not participate in `intercom` or `contact_supervisor`. | Per baseline correction: Lead-to-User communication is ordinary Codex conversation, NOT `contact_supervisor`. |
| **Subagent** | A Pi subagent session launched by `pi-subagents`. Subagents are the Researcher, Architect, Engineer, Critic, and Reviewer roles. | Each subagent runs in its own session with the role's tool surface defined in `.pi/agents/<role>.md`. |
| **Peer** | Any other live Pi session reachable via `intercom`. In this project's rolled-out topology, peers are: Researcher, Architect, Engineer, Critic, Reviewer (subject to the bounded pairs in baseline item 4 and the policy described in **Blocker 2 — Pair-level authorization**). | Codex peers participate if and when their harness is wired in; otherwise the Lead-Worker pairs cover the surface. See §2 entry "Codex peer participation" and the corresponding non-blocking risk clarification in §14. |
| **Codex peer participation** | CONDITIONAL on Lead's runtime being wired as an intercom peer. | Phrased as: "Codex peers participate if and when their harness is wired in; otherwise the Lead-Worker pairs cover the surface." Not assumed. |
| **`intercom`** | The runtime tool registered by the `npm:pi-intercom` extension. Actions: `list`, `list-cwd`, `send`, `ask`, `reply`, `pending`, `status`, `cancel` (verified at `npm/node_modules/pi-intercom/index.ts:1827`). | NOT listed in any agent definition's `tools:` field today. Wiring is a runtime concern (see §4.1). The `cancel` action takes a `messageId` and only requests cancellation of a previously SENT message; it is out of scope for subagent lifecycle control (see **Blocker 1 — Cancellation semantics**). |
| **`contact_supervisor`** | The runtime tool registered by `npm:pi-intercom` extension **only when `pi-subagents` supplies child bridge metadata**. Verified enum: `reason ∈ {"need_decision", "progress_update", "interview_request"}` (`npm/node_modules/pi-intercom/index.ts:1543`). | NOT visible to normal parent Pi sessions. NOT in Critic's or Reviewer's tool list today. |
| **Logical request** | One piece of work the originator intends to be done once. Identified by exactly one UUID generated at origination and reused for every retry (§5). | Distinct from a single `intercom send` invocation, which may be at-least-once delivered. |
| **Correlation id** | A UUID carried in the message text of an `intercom send` reply so the receiver can match the reply to the originating logical request. | Convention from AGENTS.md: "include the originating task or message identifier in the response text." |
| **Currently working — evidenced** | A capability that is installed in `.pi/settings.json` and/or in `npm/node_modules/pi-intercom/index.ts` and is reachable by the role that needs it today. | See §8.1. |
| **Designed but unproven — requires empirical test** | A capability described by this architecture whose runtime behavior has not been observed end-to-end on this project. | See §8.2. Must pass the acceptance matrix in §10 before being relied on. |
| **Package handoff channel** | The convention in this project for delivering larger artifacts between roles, layered on top of peer `intercom` messaging (which carries only text and small attachments). | Preserved from v2. Specific carriers are not enumerated here; v2 does not regress this. |

---

## 3. Roles, channels, and escalation

### 3.1 Roles and decision authority

Authority is per **decision**, not per agent, using a single-accountable-owner rule. Conflict precedence (baseline D-1, subject to User confirmation): **User > Lead > domain-specialist-on-domain > domain-specialist-off-domain**. The `most-recent-writer` tail is **not** adopted as a default (baseline correction).

| Role | Decides (final) | Advisory only | Cannot decide |
|---|---|---|---|
| **User** | Product scope, irreversible actions, security/data-handling policy, approval to publish, scope changes that invalidate prior decisions. | — | Procedural execution (Lead may execute). |
| **Lead (Codex)** | Delegation topology, task breakdown, prioritization, when to escalate, batching, which agent-decided items surface. Owns the canonical plan. | — | Domain facts inside an agent's specialty. |
| **Researcher** | Scope of evidence search, depth choice, retained sources, contradictions to record. Final wording of research briefs. | Confidence levels, interpretation beyond evidence. | Product decisions; implementation; architecture. |
| **Architect** | Architectural boundaries, interface contracts, data flow, simpler-alternative verdict. Final wording of architecture artifacts. | Implementation patterns within an approved design. | Product scope; implementation outside the artifact. |
| **Critic** | Accept / revise / reject verdict on the artifact under review. Severity ordering. | Design alternatives. | Rewriting the artifact; changing scope. |
| **Reviewer** | Accept / request-changes verdict on code changes. Severity ordering. | Architecture or product decisions. | Editing files (read-only by definition). |
| **Engineer** | Implementation tactics inside an approved plan; file changes; local test runs. | Anything that violates approved scope, introduces new dependencies, or changes interfaces. | Architecture; product scope; publishing artifacts. |

Authority-confusion guard: any decision touching more than one agent's accountable row triggers Lead's tie-break; if Lead is conflicted, Lead escalates to User via `contact_supervisor({ reason: "interview_request", interview: { ... } })` for structured multi-option, or via `contact_supervisor({ reason: "need_decision", message: "..." })` for a single blocking decision.

### 3.2 Communication channels

| Channel | Direction | Tool | When | Notes |
|---|---|---|---|---|
| **Lead ↔ User** | Both ways | **Ordinary Codex conversation** | Routine and blocking both. | Baseline correction: not `contact_supervisor`, not `intercom`. |
| **Lead → Subagent (routine delegation)** | One way (Lead → subagent) | `pi-subagents` task launch | Routine task assignment. | Returns through `pi-subagents`, not `contact_supervisor`. |
| **Subagent → Lead (escalation)** | One way (subagent → Lead) | `contact_supervisor` (reasons below) | When blocked, uncertain, needing approval, or facing a product/API/scope decision. | `interview` payload allowed only with `reason: "interview_request"`. |
| **Subagent → Lead (completion handoff)** | One way (subagent → Lead) | Return through `pi-subagents` | Routine completion. | Do NOT use `contact_supervisor` for completion handoffs. |
| **Subagent ↔ Peer (bounded)** | Both ways | `intercom({ action: "send" })` non-blocking; `intercom({ action: "ask" })` blocking | Bounded pairs per baseline item 4, with mirror-to-Lead per baseline item 7 and the policy in **Blocker 2 — Pair-level authorization**. | `send` returns after delivery without waiting for a reply; a reply, if any, arrives as a later injected turn carrying the originating task id in text. |
| **Lead ↔ Subagent (mirror back)** | Both ways | `intercom({ action: "send" })` | When Codex Lead is reachable as a peer or needs to relay a mirrored message. | CONDITIONAL on Lead's harness being wired in (see §2 "Codex peer participation"); not assumed. |

### 3.3 `contact_supervisor` — the closed enum

The `contact_supervisor.reason` field is a closed enum. The verified values from the installed package (`npm/node_modules/pi-intercom/index.ts:1543`) are:

| Value | Blocking? | Required payload | Used for |
|---|---|---|---|
| `need_decision` | **Yes** (waits for reply; fails fast if no live reply path) | `message: string` (required) | Single blocking clarification, approval gate, or scope question that requires a reply before the subagent can continue. |
| `interview_request` | **Yes** (waits for reply) | `interview: { title?, description?, questions: [{ id, type, question, options?, context? }] }` where `type ∈ {"single", "multi", "text", "image", "info"}` | Multiple structured questions to Lead in one blocking exchange. |
| `progress_update` | **No** (fire-and-forget) | `message: string` (required) | Meaningful plan-changing progress or unexpected discoveries. **Not** for routine completion. |

**Extension protocol for closed-enum compliance.** v2 (and v2.1) does NOT add new enum members. To carry structured information beyond the closed enum, subagents use:

1. The `interview` payload field for `interview_request` (this field is in the installed schema).
2. A **namespaced free-form prefix** in the `message` string for `need_decision` and `progress_update`. Example convention: `code:decision/v1; plan:v0.3; artifact:.pi/research/x.md@v0.2; body:<one-line question>`. The runtime ignores everything before the first `;` other than the verb marker; Lead parses the prefix as a hint, not as a contract.
3. The same UUID-reuse rule for `progress_update` as for `request` (§5).

**Forbidden extensions:** inventing new enum members (`reason: "blocking"`, `reason: "warning"`, `reason: "cancel"`, etc.); adding a sibling field that the runtime does not recognize; encoding priority in the `reason` field.

### 3.4 Peer messaging envelope (text conventions, not envelope schema)

The installed `intercom({ action: "send", to: ..., message: ... })` accepts a single text message. v2 (and v2.1) specifies **text conventions**, not envelope-schema fields, because no structured envelope schema is part of the substrate today.

Recommended text shape (markdown fenced, **not** a schema, used for human readability and grep-ability):

```
id: <UUID — the logical-request UUID, reused on retry>
correlation_id: <UUID — same as id on first send; echoes id on reply>
kind: request | reply | error | progress   # OUR CONVENTION for routing/audit; not a substrate enum
references: { plan_version?: vN, artifact_path?: <path>, artifact_version?: vN, decision_id?: YYYY-MM-DD-NN }
subject: <short summary, ≤80 chars>
body: <the message>
```

Rules:

- `id` is the §5 idempotency UUID. **Same UUID on every retry of the same logical request.**
- `kind` is one of `request`, `reply`, `error`, `progress`. Replies echo the originating `correlation_id` in the body prefix per AGENTS.md. **The `kind` set above is OUR convention for routing and audit, not part of the substrate's enum.** The substrate does not validate, route, or interpret `kind`; the protocol is upheld at the Agent layer.
- `references.artifact_version` is the version label the sender saw at compose time. Receivers on a newer version reply with `kind: "error"` plus a `stale_reference` note and the current canonical version.
- `intercom({ action: "send", ... })` returns after delivery without waiting for a reply. A reply, if any, arrives as a later injected turn carrying the originating task id in text. Do not treat `send` as synchronous request/response.
- No payload hash, no merkle root, no content checksum. (Baseline.)

**Forbidden envelope elements:** `priority: blocking`, `reply_path: live` (or any value), `causation_id` (replaced by `references`), `expires_at` (replaced by `progress_update` for live status and by retry-on-stale for staleness).

---

## 4. Intercom coverage and wiring

### 4.1 The honest state today

None of the five existing agent definitions (`architect.md`, `critic.md`, `engineer.md`, `researcher.md`, `reviewer.md`) list `intercom` in their `tools:` field. Verified 2026-08-21:

| Role | `tools:` field (verbatim) | Has `intercom`? | Has `contact_supervisor`? |
|---|---|---|---|
| architect | `read, grep, find, ls, write, contact_supervisor` | No | Yes |
| critic | `read, grep, find, ls` | No | **No** |
| engineer | `read, grep, find, ls, bash, edit, write, contact_supervisor` | No | Yes |
| researcher | `read, write, web_search, web_extract, research_checkpoint, contact_supervisor` | No | Yes |
| reviewer | `read, grep, find, ls` | No | **No** |

`intercom` is registered by the `npm:pi-intercom` extension at runtime, **not** declared in agent definitions. Whether each role's runtime sees the `intercom` tool depends on the runtime's allowlist for that session. v2 (and v2.1) does not assume that allowlist is currently expanded to include Critic, Reviewer, or any specific peer pair.

**v2.1 explicitly does not claim `intercom` is currently exposed to any agent role.** v2 (and v2.1) specifies how exposure is to be achieved; whether it is achieved today is verified by the acceptance matrix in §10.

### 4.2 How `intercom` is exposed to each role that needs it

Agent definitions in `.pi/agents/` are immutable for this design exercise (baseline correction: "Agent definitions ... are authoritative and immutable for design exercises"). Wiring therefore happens in the **runtime allowlist**, not in agent files.

| Role | Needs `intercom`? | Wiring mechanism (runtime, not agent file) |
|---|---|---|
| **Lead (Codex)** | Yes — to mirror messages, to surface escalations from Critic/Reviewer that arrive via intercom, and to act as a peer when subagents mirror. | Codex Lead must run in a session where the `intercom` tool is registered. Codex peer participation is **conditional** on this wiring (see §2 and §14 clarification 3); it is NOT assumed in v2.1. |
| **Architect** | Yes — for Architect ↔ Critic and Architect ↔ Researcher peer exchanges (baseline item 4). | Architect already has `contact_supervisor`. Adding `intercom` requires the runtime allowlist to register it for the Architect session. This is a runtime change, not an agent-definition edit. |
| **Researcher** | Yes — for Researcher ↔ Architect peer exchanges (baseline item 4). | Same runtime-allowlist requirement as Architect. |
| **Critic** | Yes — Critic needs an escalation channel because it has no `contact_supervisor` (§4.3). | Same runtime-allowlist requirement. Without this wiring, Critic's only escalation path is report-as-artifact (§4.3). |
| **Reviewer** | Yes — same as Critic (§4.3). | Same runtime-allowlist requirement. |
| **Engineer** | Yes — for Engineer ↔ Reviewer and Engineer ↔ Architect peer exchanges. | Same runtime-allowlist requirement. |

**v2.1 statement:** the wiring above is a **requirement**, not a current capability. The acceptance matrix (§10) gates rollout on empirical demonstration that the allowlist is configured for each role that needs it; until that gate is passed, peer messaging between any two roles must be considered **unproven**.

### 4.3 Critic and Reviewer escalation when `contact_supervisor` is absent

Critic and Reviewer have no `contact_supervisor` in their tool list (verified at `.pi/agents/critic.md` and `.pi/agents/reviewer.md`), and `acceptanceRole: read-only` rules out the write tools that would let them trigger other escalation channels. This is a real coverage gap. v2 (and v2.1) specifies two escalation paths and orders them:

**Path 1 — Peer intercom escalation (preferred, requires wiring in §4.2).**
When the runtime allows Critic/Reviewer to register `intercom`, the escalation is:

```
intercom({ action: "send", to: "lead", message: "[escalation] id:<UUID> kind:request subject:<one-line> body:<the blocker>" })
```

This is non-blocking (fire-and-forget). `send` returns after delivery without waiting for a reply; a reply, if any, arrives as a later injected turn carrying the correlation id. The Critic/Reviewer continues independent work after the send. Lead receives the message as an injected turn on the next available beat and responds with a second `intercom({ action: "send", to: "<critic-or-reviewer-session>", message: "..." })` carrying the correlation id.

**Path 2 — Report-as-artifact escalation (fallback, always available).**
Critic/Reviewer writes a verdict or escalation file under `.pi/reviews/critic/<artifact>.md` or `.pi/reviews/reviewer/<change>.md` and surfaces it in the verdict. Lead is expected to read `.pi/reviews/**` at the start of each phase boundary. This is the lowest-common-denominator escalation path; it works today without any runtime wiring change.

**Ordering rule:** Path 1 is preferred for blocking escalations (Critic's `accept`/`reject` verdict is blocking per v1 §2). Path 2 is acceptable for non-blocking findings. If Path 1's wiring is not in place when the next Critic/Reviewer cycle runs, Path 2 is used and the missing wiring is recorded as an open risk (§11).

**Why `intercom({ action: "ask" })` is not used here.** `ask` is blocking. Critic and Reviewer are read-only roles; a blocking ask would tie up the Critic/Reviewer turn. v2 (and v2.1) keeps escalation non-blocking and routes the blocking behavior to Lead's response, not to the Critic/Reviewer.

### 4.4 Pair allowlist and mirror rule

Baseline item 4 fixes the bounded peer pairs for the initial rollout:

- Researcher ↔ Architect
- Architect ↔ Critic
- All other pairs route through Lead.

Baseline item 7 fixes the mirror rule: any peer exchange that changes downstream work, exposes a new material risk, or invalidates an accepted assumption is mirrored to Lead **immediately**; cosmetic clarifications can wait for the next phase boundary.

> See **Blocker 2 — Pair-level authorization** for how the bounded-pair rule is enforced as Agent policy (NOT transport ACL). pi-intercom is a generic local session bus with no pair-level ACL; the bus does not reject unauthorized pairs.

v2 (and v2.1) adds the following operational rule:

- A subagent that successfully completes a peer exchange must write the exchange to its own role memory under a `[mirror:<peer-id>]` prefix and a `[mirrored-to-lead:<timestamp>]` suffix once the mirror send completes.
- Mirror delivery itself is non-blocking. The mirror is not an authorization to proceed; it is a notification.

---

## 5. Idempotency rule

### 5.1 The rule

**One UUID is generated per logical request at origination. That same UUID is reused for every retry of the same logical request.** The UUID is the idempotency key; it is not derived from any payload hash, intent string, plan version, sender name, or content. It is a single UUIDv4 generated once.

### 5.2 Why no deterministic hashing

Deterministic hashing of `(sender, intent, plan_version)` or of payload contents is forbidden because:

- Plans change between retry attempts. A retry of a logical request after a plan version bump should be the **same logical request** with the same idempotency UUID, so the receiver can dedupe it. A hash of the plan version would change between attempts and the dedupe key would collide with itself.
- Senders refine message text between attempts. The refined text is still the same logical request; hashing the text would produce a different key per attempt.
- Hashing produces collision risk by birthday paradox; UUIDs do not, in practice, collide.

### 5.3 Generation point

| Originating context | Generation point |
|---|---|
| Logical request that originates from Lead (Codex) | Generated by Lead at the moment of task assignment. Passed to the subagent as a field of the task payload. |
| Logical request that originates from a subagent (e.g., a peer escalation, an Engineer retry of a previous request) | Generated by the originating subagent at the moment the logical request is first composed. The subagent stores the UUID in its own role memory before sending. |
| Mirror from subagent to Lead | Carries the **same UUID** as the originating peer exchange, plus a `mirror:true` marker in `references`. |
| Reply to a logical request | Does NOT generate a new UUID; echoes the originating UUID in `correlation_id` and `references.message_id`. |

### 5.4 Storage and dedup

The receiver observes a **package-store dedup window of 1 hour** for inbound messages keyed on `(idempotency_key, recipient)`. A duplicate within that window is acknowledged with the **original reply**, not re-processed.

This 1-hour package-store window is a property of the inbound message store and is **independent** of any OPTIONAL role / peer cache the Agent may keep locally. The dedup window determines whether the substrate treats an inbound as a duplicate; the Agent-side role/peer cache (if any) is an Agent-side optimization for fast lookup, retention, or for tracking partial state across runs. The two are separate concerns with separate lifecycles:

- **Package-store dedup window (1 hour).** Determines substrate-level duplicate handling for inbound messages. Lives in the package store.
- **Optional Agent-side role / peer cache.** A per-Agent local cache (e.g., for routing hints, partial state, recent peers). Lives in the Agent's role memory when used. Optional, and not relied on by the dedup rule.

A duplicate is acknowledged with the **original reply**, not re-processed. **The receiver MUST also dedup on the originating-message UUID when it is not the idempotency key.** For example, when an `intercom send` arrives carrying `id: <UUID>` in the message text, the receiver first looks up `<UUID>` in the inbound-message store; if found within the 1-hour window, the receiver replays the cached original reply instead of re-processing.

---

## 6. Scope-change protocol

### 6.1 The protocol (corrected)

Per baseline item 9: **scope changes use mark-stale, cancel or reach a safe boundary, preserve partial results, and restart under a new plan version. Do not assume live parent-to-subagent broadcast exists.**

> See **Blocker 1 — Cancellation semantics** for the corrected procedure. v2's wording about `intercom({ action: "cancel", to: "<subagent-session>" })` is removed; that substrate action does not cancel subagent tasks. The corrected procedure replaces every "forced stop / hard kill" claim with mark-stale, ignore-stale-results-except-valid-partials, safe-boundary OR empirically-tested process mechanism, and new-run-under-new-plan.

The protocol (corrected to match baseline item 9 and the substrate reality, see **Blocker 1 — Cancellation semantics**):

1. **Decide.** The scope change is decided by User, Lead, or by an accepted escalation. The decision is logged to `.pi/decisions/<YYYY-MM-DD>-scope-<slug>.md` with the new `plan_version`, `supersedes:` pointing to the prior version, and a description of the change.
2. **Mark stale.** Lead updates the canonical plan with the new `plan_version`. Any artifact written under the old `plan_version` is marked stale by appending a `STALE-AS-OF:<new-plan-version>` note to the file's header. Stale artifacts are still readable but cannot be cited as authoritative.
3. **Cancel or reach safe boundary.** For each in-flight subagent, Lead decides between (a) let the subagent reach its current safe boundary and (b) a separately verified process-level cancellation mechanism — see **Blocker 1 — Cancellation semantics** for the corrected procedure and the empirical-test gate.
4. **Preserve partial results.** Each cancelled / boundary-closing subagent writes its `partial_artifact_path` to its own role memory and to `.pi/decisions/<...>-cancellation-<slug>.md` as a brief log entry. Partial artifacts that remain valid under the new plan are preserved and reused.
5. **Restart.** Lead re-launches the affected subagents under the new `plan_version`. The new task payload references the preserved partial result.

### 6.2 What this replaces in v1

- v1 §4 "scope_change broadcast to all in-flight agents carrying the new plan_version" — removed. The protocol is mark-stale-then-cancel/safe-boundary-then-restart, not live broadcast. This matches baseline item 9's "do not assume live parent-to-subagent broadcast exists."
- v1 §4 "scope_ack" reply kind — removed.

### 6.3 Empirical test

The cancellation/restart leg of this protocol is gated on acceptance test AT-CANCEL (§10, corrected under **Blocker 1 — Cancellation semantics**).

---

## 7. Tamper detection (git history review)

### 7.1 The method

Decision-log tampering detection is performed by **ordinary git history review** using standard git tooling:

| Check | Command | Pass criterion |
|---|---|---|
| Verify a decision file is append-only | `git log --follow --diff-filter=AM --pretty=format:"%h %ad %s" -- .pi/decisions/2026-08-21-agent-team-communication-baseline.md` | The file appears only with `A` (added) and `M` (modified) entries. A `D` (deleted) entry is a finding. |
| Verify a contradiction declared `supersedes:` | `git grep -n "^supersedes:" .pi/decisions/` | Every contradiction-bearing decision has a `supersedes:` line. |
| Inspect a specific edit | `git log -p -- .pi/decisions/<file>.md` | The diff is human-reviewable; no edits are made to past decision text. |
| Confirm no out-of-band edits | `git diff HEAD~N -- .pi/decisions/<file>.md` for the relevant window | No edits that change prior decision text are present. |

### 7.2 What v2 (and v2.1) does NOT claim

- v2 (and v2.1) does **NOT** claim cryptographic integrity, WORM storage, append-only enforcement by the filesystem, or hash-chained audit trails.
- v2 (and v2.1) does **NOT** claim `mtime` as a tamper signal (mtime is trivially forgeable).
- v2 (and v2.1) does **NOT** claim tamper-proof storage of any kind.

### 7.3 What v2 (and v2.1) does claim

- v2 (and v2.1) claims that **git history, reviewed by a human, is the audit mechanism** for the decision log. This is a social-process claim, not a cryptographic one.

---

## 8. Capability split: evidenced vs. unproven

### 8.1 Currently working — evidenced

Each row is verified by direct inspection of the installed substrate (`.pi/settings.json` or `npm/node_modules/pi-intercom/index.ts`). No row here depends on agent-definition edits.

| # | Capability | Evidence | Notes |
|---|---|---|---|
| C1 | `intercom` tool is registered at runtime by the `npm:pi-intercom` extension. | `npm/node_modules/pi-intercom/index.ts:1827` defines the tool with `action` enum `["list", "list-cwd", "send", "ask", "reply", "pending", "status", "cancel"]`. | Verified presence in package source. Which sessions see it at runtime is **not** evidenced here — see §8.2. |
| C2 | `contact_supervisor` tool is registered at runtime by `npm:pi-intercom` **only when `pi-subagents` supplies child bridge metadata**. | `npm/node_modules/pi-intercom/index.ts` registers `contact_supervisor` only inside `if (childOrchestratorMetadata && !nativeSupervisorChannelAvailable)` (verified at lines ~1530-1540). | Normal parent Pi sessions do NOT see `contact_supervisor`. |
| C3 | `contact_supervisor.reason` is a closed enum with exactly three values: `need_decision`, `progress_update`, `interview_request`. | `npm/node_modules/pi-intercom/index.ts:1543` declares `StringEnum(["need_decision", "progress_update", "interview_request"] as const, {...})`. | The runtime rejects other values; v2 (and v2.1) does not invent new members. |
| C4 | `contact_supervisor.interview` payload schema (for `interview_request`) is `interview: { title?, description?, questions: [{ id, type, question, options?, context? }] }` with `type ∈ {"single","multi","text","image","info"}`. | `npm/node_modules/pi-intercom/index.ts:1554`. | This is the v2 (and v2.1) extension mechanism for structured escalation. |
| C5 | `intercom({ action: "send" })` returns after delivery without waiting for a reply. | `npm/node_modules/pi-intercom/index.ts` invocation usage shows `send` invokes the client and returns; AGENTS.md codifies the async convention. | "include the originating task or message identifier in the response text." Replies, if any, arrive as later injected turns. |
| C6 | `intercom({ action: "ask" })` is the only blocking peer primitive. | `npm/node_modules/pi-intercom/index.ts:1818` defines `ask`; AGENTS.md says `reply` is the matching primitive. | `reply` resolves `ask`, not `send`. |
| C7 | The decision-log location convention `.pi/decisions/<YYYY-MM-DD>-<slug>.md` is followed by the existing baseline file. | File present at `.pi/decisions/2026-08-21-agent-team-communication-baseline.md`. | Convention is observed, not enforced. |
| C8 | Substrate constraint: only `npm:pi-intercom`, `npm:pi-subagents`, `npm:pi-web-access` are installed. | `.pi/settings.json`. | No pub/sub, no blackboard, no external Kafka/Redis. |
| C9 | Agent tool surfaces are fixed (architect, critic, engineer, researcher, reviewer — none has `intercom` in `tools:`; critic and reviewer have no `contact_supervisor`). | `.pi/agents/*.md` frontmatter. | Verified 2026-08-21. |
| C10 | `pi-subagents` returns subagent results to the parent session on completion (routine completion does not cross `contact_supervisor`). | Per `npm:pi-intercom` README: "Do not use `contact_supervisor` for routine completion handoffs. Return the final subagent result normally through `pi-subagents`." | Convention observed by the reference implementation. |
| C11 | `intercom({ action: "cancel" })` operates on a `messageId` and only requests cancellation of a previously SENT message. It is NOT subagent task cancellation. | `npm/node_modules/pi-intercom/index.ts` shows `cancel` invokes `connectedClient.cancelMessage(messageId)`; see **Blocker 1 — Cancellation semantics**. | Out of scope for subagent lifecycle control. |

### 8.2 Designed but unproven — requires empirical test

Each row is part of v2 (and v2.1)'s design but is **not** verified by inspection of the installed substrate today. Each row maps to one or more acceptance tests in §10.

| # | Capability | Why unproven | Required test |
|---|---|---|---|
| U1 | `intercom` is exposed to Architect, Engineer, Researcher sessions at runtime. | Agent `tools:` fields do not list `intercom`; runtime allowlist is not documented. | AT-ALLOWLIST-EXP |
| U2 | `intercom` is exposed to Critic and Reviewer sessions at runtime (so they can escalate via Path 1 in §4.3). | No runtime wiring is in any installed file. | AT-ALLOWLIST-EXP, AT-CRITIC-ESC, AT-REVIEWER-ESC |
| U3 | `intercom({ action: "list-cwd" })` returns the expected peer set (Critic/Reviewer/Architect/Engineer/Researcher) for each role that has it. | Tool is registered; the runtime's peer-discovery output has not been observed. | AT-DISCOVERY |
| U4 | `intercom({ action: "send" })` returns after delivery without waiting for a reply (non-blocking at the sender's tool-result stream). | Documented by AGENTS.md; not observed end-to-end on this project. | AT-ASYNC-SEND |
| U5 | A reply to a `send` carries the originating task id in its text such that the sender can correlate. | AGENTS.md specifies the convention; round-trip is not observed. | AT-CORRELATION |
| U6 | Codex Lead receives an `intercom`-bound mirror and does not confuse it with ordinary Codex conversation. | No demonstration exists in this project. Wiring is CONDITIONAL (see §2). | AT-LEAD-MIRROR |
| U7 | `contact_supervisor({ reason: "need_decision" })` from Architect / Engineer / Researcher reaches Lead. | Tool is registered only under child-bridge-metadata; not exercised. | AT-SUPERVISOR-ESC |
| U8 | A duplicated `intercom send` carrying the same logical-request UUID is deduped by the receiver within the 1-hour package-store window (no duplicate processing, original reply replayed). | Convention documented; not exercised. The 1-hour window is the package-store dedup property; an OPTIONAL Agent-side role cache does not substitute for it. | AT-DEDUP |
| U9 | The decision-log tamper-detection method (git history review) actually surfaces a synthetic out-of-band edit when one is introduced in a test fixture. | Process claim; not exercised. | AT-TAMPER (process test) |
| U10 | The scope-change protocol (mark-stale, cancel/safe-boundary, preserve-partial, restart) works without orphan tasks. | Per baseline item 9: do not assume live broadcast exists. The protocol is correct in design but its behavior is unverified, and any process-level cancellation relies on a separately verified mechanism. | AT-CANCEL (corrected under **Blocker 1 — Cancellation semantics**) |
| U11 | The Critic/Reviewer Path-1 escalation (intercom to Lead) reaches Lead and is acted on. | Wiring is unproven; without wiring, only Path 2 (report-as-artifact) is exercised. | AT-CRITIC-ESC, AT-REVIEWER-ESC |
| U12 | A disallowed peer pair (per baseline item 4 / Agent policy) is refused BEFORE any `intercom` `send` call is observed in the Agent trace. | `pi-intercom` is a generic local session bus with no pair-level ACL (see **Blocker 2 — Pair-level authorization**); enforcement is Agent policy, not transport. | AT-UNAUTH-PAIR (corrected under **Blocker 2 — Pair-level authorization**: negative-control trace) |

### 8.3 Capability-state matrix (at a glance)

| Capability | Working | Unproven | Test gating |
|---|---|---|---|
| `intercom` registered | ✓ (C1) | — | — |
| `intercom` exposed to a specific role's session | — | ✓ (U1, U2) | AT-ALLOWLIST-EXP |
| Peer discovery via `list-cwd` | — | ✓ (U3) | AT-DISCOVERY |
| Async `send` returns after delivery without waiting for a reply | — | ✓ (U4) | AT-ASYNC-SEND |
| Correlation id round-trip | — | ✓ (U5) | AT-CORRELATION |
| Codex Lead mirroring | — | ✓ (U6) | AT-LEAD-MIRROR |
| Subagent → Lead escalation via `contact_supervisor` | — | ✓ (U7) | AT-SUPERVISOR-ESC |
| Critic/Reviewer escalation via `intercom` to Lead | — | ✓ (U2, U11) | AT-CRITIC-ESC, AT-REVIEWER-ESC |
| Stale-run cancellation / safe-boundary / new-run without orphan | — | ✓ (U10) | AT-CANCEL (corrected) |
| Duplicate dedup by logical-request UUID within 1-hour package-store window | — | ✓ (U8) | AT-DEDUP |
| Disallowed peer pair refused before any `send` call (Agent policy) | — | ✓ (U12) | AT-UNAUTH-PAIR (corrected: negative-control trace) |
| Git-history tamper detection | ✓ (process, C7) | ✓ (U9) | AT-TAMPER |

---

## 9. Degraded modes

Per baseline item 10 and the agent tool surfaces:

| Agent | Unavailable consequence | Fallback |
|---|---|---|
| Researcher | Reduced evidence coverage on the affected sub-question. | Lead proceeds with documented assumption; confidence marked MEDIUM. |
| Engineer | Implementation blocked. | Lead either waits, re-launches Engineer, or surfaces to User. |
| Architect | Architecture update blocked. | Downstream agents hold until Architect is available. |
| **Critic** | Adversarial pass skipped. | Lead marks the artifact `unverified-architecture` and proceeds **only if** the next action is **not** in baseline item 10's block list (security-sensitive, irreversible, publishing, deployment, external-user, billing, secret, or remote-infrastructure). Blocked actions wait for Critic or User decision. |
| **Reviewer** | Code-review pass skipped. | Engineer self-validates with documented test commands; Lead marks the change `unreviewed-at-merge` and includes it in the next phase summary. |
| **Lead (Codex)** | User has no integration point. | Stop. There is no Lead surrogate in this architecture. Escalate to User only via ordinary Codex conversation if a Codex surface is still available; otherwise halt. |

---

## 10. Acceptance matrix

> **Two rows in this matrix are corrected under Blocker 1 and Blocker 2** (see in-line corrected sections below). All other rows are preserved verbatim from v2. Every row is a runnable scenario. "Setup" is the precondition. "Action" is the exact tool invocation or scenario trigger. "Expected result" is the observable behavior. "Observe pass/fail" is the verification step. All tests are gated on v2 rollout; no test is considered passed by v2 alone.

### 10.1 Test table

| Test ID | Setup | Action | Expected result | Observe pass/fail |
|---|---|---|---|---|
| **AT-ALLOWLIST-EXP** | A Pi session is launched for each role (architect, critic, engineer, researcher, reviewer). | For each role, the launched session inspects its registered tools (e.g., by listing the tools its system prompt advertises, or by attempting an `intercom({ action: "list" })` call). | Architect, Engineer, Researcher: `intercom` is in the registered tool list. Critic, Reviewer: `intercom` is in the registered tool list **only after** the runtime allowlist is expanded. Until then, the test FAILS for Critic/Reviewer and the missing wiring is recorded as an open risk. | Pass = each required role sees `intercom`. Fail = a required role does not see `intercom` and the gap is recorded. |
| **AT-DISCOVERY** | AT-ALLOWLIST-EXP has passed for the role under test. | From each role's session, run `intercom({ action: "list-cwd" })`. | The returned peer list contains exactly the bounded pairs allowed by baseline item 4 for that role, plus the Lead peer if Lead is reachable from that session. No unallowed peer is returned. | Pass = peer set matches baseline item 4. Fail = unexpected peer or missing required peer. |
| **AT-ASYNC-SEND** | Two Pi sessions live in the same cwd; sender has `intercom` registered. | Sender runs `intercom({ action: "send", to: "<receiver>", message: "id:<UUID> kind:request subject:ping body:hello" })`. Wall-clock the call. | The `send` tool call returns within ≤2 s regardless of whether the receiver is currently processing; it returns after delivery without waiting for a reply. | Pass = call returns immediately. Fail = call blocks >2 s. |
| **AT-CORRELATION** | AT-ASYNC-SEND has passed. | Receiver injects the message as a turn and replies with `intercom({ action: "send", to: "<sender>", message: "id:<UUID-of-reply> correlation_id:<UUID-from-original> kind:reply references:{message_id:<UUID-from-original>} body:<reply>" })`. | The sender receives the injected reply; the `correlation_id` in the reply text matches the `id` of the original send; the sender can pair the reply to the original. | Pass = ids match end-to-end. Fail = id drift. |
| **AT-NON-BLOCK-SENDER** | Two Pi sessions live; sender has work pending after the send. | Sender runs `intercom({ action: "send", to: "<peer>", message: "id:<UUID> kind:request subject:queue-test body:..." })` and then immediately performs an independent tool call (e.g., `read` of a local file). | Sender's `read` returns successfully before any reply from the peer arrives. The `send` returns after delivery without waiting for a reply, so the sender's tool-result stream is non-blocking. | Pass = `read` completes pre-reply. Fail = sender waits. |
| **AT-LEAD-MIRROR** | A subagent (Architect) is delegated a task by Lead (Codex). Lead is reachable as a peer in the runtime (CONDITIONAL on wiring; see §2). | Architect, on completing a step that mirrors to Lead (per baseline item 7), runs `intercom({ action: "send", to: "lead", message: "id:<UUID> kind:request subject:mirror references:{plan_version:v0.3} body:<the mirrored content>" })`. | Lead's Codex conversation stream receives the mirror as a clearly-labeled intercom-bound message (e.g., prefixed with `[intercom-mirror]`) and does not treat it as an ordinary Codex turn from the User. Lead reads the mirror, decides, and continues. | Pass = mirror is distinguishable from user input. Fail = mirror is conflated with user input or is silently dropped. |
| **AT-SUPERVISOR-ESC** | Architect (or Engineer or Researcher) subagent has been delegated a task and is blocked on a product/API/scope decision. | The subagent runs `contact_supervisor({ reason: "need_decision", message: "id:<UUID> kind:request subject:scope-decision body:<the question>" })`. | Lead (Codex) receives the escalation as a structured event distinguishable from ordinary Codex conversation. The subagent's tool call blocks until Lead replies (via the runtime's reply path) or fails fast with a clear "no live reply path" error if Lead is not reachable. | Pass = escalation reaches Lead and reply returns to the subagent. Fail = silent drop or wrong channel. |
| **AT-CRITIC-ESC** | Critic has produced a `reject` verdict that includes a blocker. Critic's runtime allowlist does include `intercom` (else Path 2 is used and the test result is recorded as a wiring gap). | Critic runs `intercom({ action: "send", to: "lead", message: "id:<UUID> kind:request subject:critic-escalation references:{artifact_path:..., artifact_version:...} body:<the blocker>" })`. | Lead (Codex) receives the escalation (per AT-LEAD-MIRROR pass criteria) and treats it as a blocking finding. | Pass = Critic escalation reaches Lead. Fail = escalation lost; Path 2 (report-as-artifact) is used and the missing wiring is recorded. |
| **AT-REVIEWER-ESC** | Reviewer has produced a `request-changes` verdict on a code change. | Reviewer runs `intercom({ action: "send", to: "lead", message: "id:<UUID> kind:request subject:reviewer-escalation references:{change:<id>} body:<the blocker>" })`. | Lead (Codex) receives the escalation (per AT-LEAD-MIRROR pass criteria). | Pass = Reviewer escalation reaches Lead. Fail = fallback to inline-in-PR or verdict file; the wiring gap is recorded. |
| **AT-CANCEL** | See **Blocker 1 — Cancellation semantics** for the corrected version. v2's wording that used `intercom({ action: "cancel", to: "<subagent-session>" })` is removed. | See corrected block. | See corrected block. | See corrected block. |
| **AT-DEDUP** | Receiver has a dedup entry for `<UUID>` from a prior inbound send within the 1-hour package-store window. | Sender retries the same logical request with the **same** `id:<UUID>` in the message text. | Receiver's inbound-message store returns; the receiver injects a turn that detects the duplicate via the UUID and replays the cached original reply instead of re-processing. No second side-effect occurs. The 1-hour window is the package-store dedup property; any OPTIONAL Agent-side role/peer cache is independent of this gate. | Pass = exactly one side-effect; second send is acknowledged with the original reply. Fail = second send is re-processed. |
| **AT-UNAUTH-PAIR** | See **Blocker 2 — Pair-level authorization** for the corrected version. v2's wording asserting the runtime rejects unauthorized pairs is removed. | See corrected block. | See corrected block. | See corrected block. |
| **AT-TAMPER** | A test fixture introduces an out-of-band edit to a synthetic decision-log file under `.pi/decisions/`. | A reviewer runs `git log --follow --diff-filter=AM --pretty=format:"%h %ad %s" -- .pi/decisions/<fixture>.md` and `git log -p -- .pi/decisions/<fixture>.md`. | The out-of-band edit is visible in the diff. The reviewer can detect and report it. | Pass = edit is visible to a human reviewer. Fail = edit is invisible to git history (i.e., the fixture was bypassed). |

### Blocker 1 — Cancellation semantics

**The `intercom` tool's `cancel` action is out of scope for subagent lifecycle control.**

Verified at `npm/node_modules/pi-intercom/index.ts:1827`, the `cancel` action takes a `messageId` (not a `to: <subagent>` parameter) and invokes `connectedClient.cancelMessage(messageId)`. The action only requests cancellation of a **previously SENT intercom message** (i.e., an in-flight or undelivered message addressed to a peer session), not a subagent task, a long-running subagent invocation, or the peer session itself. There is no "forced stop / hard kill" primitive on this substrate for subagent lifecycles.

Every prior claim in v2 that an `intercom({ action: "cancel", to: "<subagent-session>" })` call cancels a subagent task is removed; every prior acceptance-test step that asserted such a cancel-and-stop behavior is removed.

**Corrected procedure for a scope change (e.g. plan revision mid-flight):**

a) **Mark STALE.** Lead updates the canonical plan with the new `plan_version`. Any artifact written under the old `plan_version` is marked stale by appending `STALE-AS-OF:<new-plan-version>` to the file's header. The stale run is identified by the `plan_version` it was launched under and a `STALE-AS-OF:<new-plan-version>` tag in its role memory.

b) **Ignore subsequent results from that stale run, EXCEPT preserve and use any partial artifacts already produced and still valid.** Results delivered after the mark-stale timestamp are not authoritative for the new plan and must not be cited. Partial artifacts (e.g., partial drafts, intermediate files, trace logs, role-memory entries) that remain valid under the new plan are preserved in `.pi/decisions/<...>-cancellation-<slug>.md` and reused where applicable.

c) **Let the stale run reach a safe boundary on its own, OR use a separately verified pi-subagents / process cancellation mechanism — and only after an empirical test demonstrates it actually stops the targeted subagent.** Do not assert such a mechanism works based on reading code alone; require a passing empirical test in CI or a documented local run before relying on it. Until that empirical-test gate is passed, treat the stale run as continuing until it reaches its own safe boundary; the acceptable safe-boundary criteria are defined per role and recorded alongside the stale-run tag.

d) **Launch a NEW run under the new plan; do not retry, steer, or revive the stale run.** The new task payload references the preserved partial result and the new `plan_version`. The stale run is left to drain.

**State explicitly that the intercom cancel action is out of scope for subagent lifecycle control.** Cancellation of sent messages remains a substrate capability (e.g., for revoking a queued `send` to a peer); cancellation of subagent tasks is NOT.

**Corrected AT-CANCEL row** (replaces the v2 AT-CANCEL row in the §10.1 table above):

| Test ID | Setup | Action | Expected result | Observe pass/fail |
|---|---|---|---|---|
| **AT-CANCEL** | An Engineer subagent is running a long task under `plan_version: v0.3`. Lead marks `v0.4` as the new plan and tags the Engineer's run as `STALE-AS-OF:v0.4`. | Lead does **not** call `intercom({ action: "cancel", to: "<engineer-session>" })`. Lead (a) records the stale-run tag in `.pi/decisions/...md`, (b) lets the Engineer subagent reach its defined safe-boundary criteria OR invokes a separately verified process cancellation mechanism only after that mechanism has passed an empirical CI/local test, and (c) launches a NEW Engineer subagent under `plan_version: v0.4` with a task payload that references the preserved partial result. | The stale Engineer's role memory carries a `STALE-AS-OF:v0.4` tag. Any post-tag results are ignored for the new plan; valid partial artifacts are preserved to `.pi/decisions/<...>-cancellation-<slug>.md`. The new Engineer under `v0.4` runs against the preserved partial result. No "forced stop / hard kill" via intercom is asserted. If a process-level cancellation mechanism is used, its empirical-test artifact is appended to the cancellation log. | Pass = stale-tag recorded, post-tag results ignored, partial result preserved, new run launched under `v0.4`, no orphan tasks under `v0.3`. Fail = stale run kept authoritative, partial result lost, or intercom `cancel` claimed to stop the subagent. |

### Blocker 2 — Pair-level authorization

**`pi-intercom` is a generic local session bus. It has NO pair-level ACL.** Verified at `npm/node_modules/pi-intercom/index.ts` — the tool exposes actions over discovered peers (`list`, `list-cwd`, `send`, `ask`, `reply`, `pending`, `status`, `cancel`) and does not reject calls based on `(sender, recipient)` pair identity. Any pair of sessions registered with the bus can address each other at the transport layer. Bounded-pair enforcement is therefore **Agent policy**, NOT transport security.

The accepted bounded pairs (from baseline item 4: Researcher ↔ Architect, Architect ↔ Critic; all other pairs route through Lead) are preserved as an **AGENT POLICY** enforced by:

- **Role prompts that instruct each role which peers it may contact.** Each role's system prompt or runtime prompt lists the allowed peer peers and instructs the role to refuse before invoking `intercom` for any peer not on that list.
- **Lead-agent auditing of intercom traffic.** Lead inspects peer traffic (visible in role-memory mirror logs and in package-store traces) and flags any `send` / `ask` from a disallowed pair. Any such finding is an Agent-policy violation, escalated per baseline item 7.

**This is NOT transport security. State this explicitly.** A compromised or non-compliant Agent could still call `intercom` to any peer that the bus exposes. Bounded pairs are a **behavioural contract**, not an access control.

The v2 acceptance test AT-UNAUTH-PAIR row that asserted "the runtime rejects the send with an 'unauthorized peer' or 'peer not in allowlist' error" is removed; the substrate does not provide such a rejection. The corrected test is a NEGATIVE-CONTROL TRACE.

**Corrected AT-UNAUTH-PAIR row** (replaces the v2 AT-UNAUTH-PAIR row in the §10.1 table above):

| Test ID | Setup | Action | Expected result | Observe pass/fail |
|---|---|---|---|---|
| **AT-UNAUTH-PAIR (negative-control trace)** | Critic and Engineer are NOT in the bounded-peer allowlist for the initial rollout (baseline item 4). The Critic's role prompt instructs the Critic that Engineer is not a permitted peer. The intercom package store and a Critic trace collector are both recording. | Critic is instructed (by the test driver) to communicate with Engineer. The Critic's role receives the instruction and decides how to respond. | **Pass = the Agent REFUSES before calling `intercom`.** No `intercom({ action: "send", to: "engineer", ... })` call (and no `ask` to `engineer`) appears in the Critic's tool-call trace. The Critic instead routes the request to Lead (mirror) or report-as-artifact as its role prompt defines. The trace collector records the refusal and the chosen fallback channel. | **Fail = any `send` call to a disallowed peer (e.g., to "engineer") appears in the trace**, regardless of whether the bus delivers it. A fail also includes any `ask` to a disallowed peer. |

**Explicit disclaimer (do not omit):** "This is not a security boundary. A compromised or non-compliant Agent could still call intercom to any peer. Bounded pairs are a behavioural contract, not an access control."

### 10.2 Acceptance gate

v2.1 is considered rolled out **only when** all 13 acceptance tests pass (the two rows corrected under Blocker 1 and Blocker 2 included). Until then:

- Peer messaging between any two roles must be considered **unproven**.
- The Critic and Reviewer Path-1 escalation (§4.3) is **unproven**; Path 2 (report-as-artifact) is the only proven fallback.
- The scope-change cancellation leg (§6) is **unproven** in its "process-level cancellation" sub-step until AT-CANCEL's empirical-test gate has been demonstrated for the specific mechanism used (the intercom `cancel` action does not provide it).

The Critic and Reviewer may continue to produce artifacts (Path 2 is always available). The Engineer and Architect may continue under baseline items 1, 3, 4, and 7, with the caveat that "peer messaging" means "the message was sent; whether the receiver received and acted on it is unverified until AT-ASYNC-SEND, AT-CORRELATION, and AT-NON-BLOCK-SENDER pass for that pair," and with the caveat that bounded-pair enforcement relies on Agent policy and Lead audit, not on a bus-level ACL.

---

## 11. Risks and open questions

### 11.1 Risks v2.1 does NOT close (could not resolve from analysis alone)

- **R-HIGH.** Whether the runtime allowlist can be configured to expose `intercom` to Critic and Reviewer sessions without violating `acceptanceRole: read-only` is an open question. v2.1 prescribes the wiring as required (§4.2, §8.2 U2) but does not prove it is possible.
- **R-MEDIUM.** Whether Codex Lead's session can be reached as a peer by Pi subagents via `intercom` is unverified. Codex peer participation is **conditional** on this wiring (see §2 and §14); it is NOT assumed in v2.1. The Lead's runtime configuration for receiving intercom messages is OUT OF SCOPE; AT-LEAD-MIRROR (§10) is the gate.
- **R-MEDIUM.** The 1-hour package-store dedup window (§5.4) is a property of the inbound message store. Role-memory persistence across restarts is not characterized for this project; an OPTIONAL Agent-side role/peer cache that does not survive restart does not affect the substrate's package-store dedup property, but it can affect downstream Agent behaviour. The two are independent concerns (see §5.4 and §14 clarification 1).
- **R-MEDIUM.** `pi-subagents` and `pi-intercom` are community packages; the closed enum and action surface may evolve. v2.1 pins against the verified surface (C1, C3, C4 in §8.1); future changes require a new architecture revision.
- **R-LOW.** UX for `contact_supervisor({ reason: "interview_request", interview: {...} })` in this project — whether the supervisor answers structured multi-option interactively or as freeform prose — is not demonstrated.
- **R-LOW.** Conflict-resolution precedence (User > Lead > domain-specialist-on-domain > domain-specialist-off-domain) is principled; the `most-recent-writer` tail has been removed per baseline correction. The chosen rule has not been exercised against a real cross-cutting decision in this project; user choice D-1 (whether the precedence rule itself is accepted) is still pending.
- **R-LOW.** Git-history tamper detection (§7) is a process claim; it depends on a human reviewer actually running the git commands on a regular cadence. No automation enforces it.
- **R-LOW.** Bounded-pair enforcement (Blocker 2) is Agent policy, not transport. A compromised or non-compliant Agent could still call `intercom` to any peer. The negative-control trace in AT-UNAUTH-PAIR verifies the **role-prompt-driven** refusal path; it does not constrain a bad-faith implementation.

### 11.2 Open questions for the next stage

- **Q1.** Confirm or revise the conflict-resolution precedence rule (baseline D-1).
- **Q2.** Confirm the runtime mechanism by which Codex Lead receives `intercom` messages (i.e., is Codex Lead's session an intercom client, or does Codex Lead only read peer artifacts on a phase boundary?).
- **Q3.** Confirm whether `intercom` can be exposed to Critic and Reviewer while keeping `acceptanceRole: read-only`.
- **Q4.** Confirm the dedup-window persistence model (per the substrate package-store 1-hour window) and, separately, whether any Agent-side role/peer cache is intended and how (these are independent concerns).
- **Q5.** Confirm the human-review cadence for `.pi/decisions/` git-history audits.
- **Q6.** Confirm the empirical-test mechanism for AT-CANCEL (which pi-subagents / process cancellation mechanism, if any, is authorised and under what test discipline).

### 11.3 Items that still require explicit user authority

Per baseline correction and per the gate in `.pi/decisions/2026-08-21-agent-team-communication-baseline.md` ("No Agent definition or communication-tool configuration may be changed until Architect produces v2 and Critic reports no blockers against this decision"):

- **I-AUTH-1.** Acceptance of v2.1 as the superseding architecture. Until Critic reports no blockers against this decision, no runtime wiring change is authorized.
- **I-AUTH-2.** Authorization to configure the runtime allowlist to expose `intercom` to Critic and Reviewer (a runtime configuration change; not an agent-definition edit).
- **I-AUTH-3.** User choice D-1 (the precedence rule for cross-cutting decisions).
- **I-AUTH-4.** Authorization to begin the acceptance matrix run (§10). The matrix must complete before any "peer messaging" is treated as proven.
- **I-AUTH-5.** Authorization to rely on any specific pi-subagents / process cancellation mechanism used in AT-CANCEL. The intercom `cancel` action is explicitly NOT authorized as a subagent-lifecycle cancellation primitive.

---

## 12. Cross-reference back to the baseline

The baseline decision `.pi/decisions/2026-08-21-agent-team-communication-baseline.md` is fixed. v2.1 implements each accepted item as follows:

| Baseline item | v2.1 section |
|---|---|
| 1. Codex is the sole Lead. | §2, §3.1, §11 (R-MEDIUM, §2 "Codex peer participation") |
| 2. Pi orchestrator is execution/communication bridge without independent authority. | §3.1 (Architect, Engineer, etc. are advisory on Lead's domain) |
| 3. Hub-and-spoke by default. | §3.2, §4.4 |
| 4. Initial peer pairs limited to Researcher ↔ Architect and Architect ↔ Critic. | §4.4, §8.2 U1, U2, AT-DISCOVERY, AT-UNAUTH-PAIR (corrected to negative-control trace under Blocker 2) |
| 5. Reviewer communicates through Lead initially. | §4.4 |
| 6. Critic/Reviewer may use `contact_supervisor` only for risk/verdict escalation. | §4.3, §9 (Critic unavailable fallback) |
| 7. Mirror-to-Lead rule with immediate/deferred split. | §3.2, §4.4 |
| 8. One UUID per logical request, reused on retry. | §5 |
| 9. Scope-change via mark-stale, cancel, preserve-partial, restart. No live broadcast assumption. | §6, §8.2 U10, AT-CANCEL (corrected under Blocker 1) |
| 10. Critic unavailable → `unverified-architecture` flag, except for blocked action classes. | §9 |
| Correction: remove `most-recent-writer`. | §3.1 |
| Correction: remove `priority: blocking`, `reply_path: live`. | §1.1, §3.4 |
| Correction: keep `contact_supervisor.reason` within closed enum. | §3.3, §4 (extension protocol) |
| Correction: do not claim allowlist = proven; require empirical test. | §8.2, §10 |
| Correction: replace mtime tamper detection with git history review. | §7 |
| Correction: Lead-to-User is ordinary Codex conversation. | §3.2, §2 |
| Correction: keep application-layer hashes out. | §3.4, §5 |
| Correction implicit in v2.1: intercom `cancel` is message-scoped, not subagent cancellation. | §6, §8.1 C11, AT-CANCEL, **Blocker 1 — Cancellation semantics** |
| Correction implicit in v2.1: bounded pairs are Agent policy, not transport ACL. | §4.4, AT-UNAUTH-PAIR, **Blocker 2 — Pair-level authorization** |

---

## 13. Document metadata

- version: v2.1 (surgical superseding revision of v2)
- changes vs. v2: two blockers corrected inline (Blocker 1, Blocker 2); four non-blocking risk clarifications added (§14); v2 text preserved verbatim otherwise

---

## 14. Non-blocking risk clarifications

These four clarifications do not rise to the level of a Blocker — they do not contradict v2's central design — but they tighten v2's wording so the architecture is unambiguous against the installed substrate. They are applied at the corresponding v2 locations (§2, §3.2, §3.4, §5.4) and consolidated here for review traceability.

### 14.1 Inbound package dedup retention is 1 hour; distinct from any optional Agent-side role/peer cache

The package-store dedup window for inbound intercom messages is **1 hour**, keyed on `(idempotency_key, recipient)`. v2's wording of "default 24 h" in §5.4 is tightened to 1 hour to match the package-store property being asserted.

The 1-hour window is a property of the **inbound message store** (the substrate side) and is **independent** of any OPTIONAL **Agent-side role/peer cache** the Agent may keep locally. The two are separate:

- **Package-store dedup window (1 hour).** Determines whether the substrate treats a particular inbound `intercom` message as a duplicate. Lives in the package store.
- **OPTIONAL Agent-side role / peer cache.** A per-Agent local store (e.g., routing hints, partial state, recent peers). Lives in the Agent's role memory when used. Optional, and not relied on by the dedup rule.

A receiver that relies on dedup MUST treat the 1-hour package-store window as the dedup gate. An Agent-side cache, if kept, is an optimization layered on top; it MUST NOT be substituted for the substrate window, and it MUST NOT be presumed to exist when reasoning about correctness.

### 14.2 `send` returns after delivery without waiting for a reply

The description of `intercom({ action: "send", to: ..., message: ... })` is rephrased everywhere it appears (in §3.2, §3.4, §4.3, §8.1 row C5, §10 AT-ASYNC-SEND and AT-NON-BLOCK-SENDER, and the corresponding AGENTS.md convention paraphrase) as:

> "Returns after delivery without waiting for a reply."

This wording does NOT imply synchronous request/response. A reply, if any, arrives as a **later injected turn** carrying the originating task id in text (per AGENTS.md), not as a return value from the `send` call. Treating `send` as sync would break the non-blocking semantics that v2's async lifecycle depends on.

### 14.3 Codex peer participation is CONDITIONAL

Codex's participation as an `intercom` peer is **conditional**, not assumed. v2.1 phrases it as:

> "Codex peers participate if and when their harness is wired in; otherwise the Lead-Worker pairs cover the surface."

This phrasing is applied in:

- §2 (Peer entry, Codex peer participation entry)
- §3.2 (Lead ↔ Subagent (mirror back) row, CONDITIONAL note)
- §4.2 (Lead (Codex) row, CONDITIONAL note)
- §8.2 row U6 and §10 AT-LEAD-MIRROR (CONDITIONAL gating)
- §11.1 R-MEDIUM (Lead-reachability risk)

Until the runtime wiring is demonstrated by AT-LEAD-MIRROR, the architecture must not assume any `intercom` from a subagent reaches Codex; the Lead-Worker bounded pairs (Researcher ↔ Architect, Architect ↔ Critic, with all other routes through Lead) cover the surface that v2.1 commits to today.

### 14.4 `kind` values are OUR CONVENTION, not part of the substrate's enum

The `kind` set used in the recommended peer-message text conventions (`request | reply | error | progress`) is **our convention for routing and audit**. It is NOT a substrate-defined enum; the installed `intercom` tool does not validate, route, or interpret `kind`. The convention is upheld at the Agent layer:

- Senders tag outbound `send` calls with `kind: <value>` in the message text.
- Receivers inspect `kind` for routing and audit purposes (e.g., to distinguish a `request` from a `reply`, or to flag a `progress` for human review).
- A `send` to a peer that lacks the convention does not break (the message is delivered as text); a peer that does not understand a particular `kind` value simply treats it as untyped text.

This clarification is applied in §3.4 (envelope rules; `# OUR CONVENTION for routing/audit; not a substrate enum` inline annotation) and is reflected in §1.4 (no substrate-defined claims are made about `kind`). No new substrate enum members are introduced.

---

## 15. Supersession summary

v2.1 supersedes v2 in full. The two blockers (Blocker 1 — Cancellation semantics, Blocker 2 — Pair-level authorization) are the load-bearing corrections and are inlined at the points where they replace v2 text. The four non-blocking risk clarifications (§14) tighten wording where v2 was imprecise but not wrong. Every other v2 section is preserved verbatim. No application-level hashes or integrity digests are added. No edits were made to v2.md, the baseline decision, the intercom source, or any agent / runtime file as part of producing this artifact.

Return: path = D:\Coding\Harness\.pi\research\agent-team-communication-architecture-v2.1.md; corrections = [Blocker 1, Blocker 2, Non-blocking risk clarifications x4]
