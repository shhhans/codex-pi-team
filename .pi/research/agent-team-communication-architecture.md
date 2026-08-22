# Agent Team Communication Architecture

**Status:** design proposal (read-only analysis, no code, no agent-definition edits)
**Audience:** Lead, User (decision owner)
**Substrate today:** `npm:pi-intercom@0.11.0`, `npm:pi-subagents`, `npm:pi-web-access` (per `.pi/settings.json`). Agent definitions under `.pi/agents/` are authoritative and treated as immutable for this exercise.

## Evidence-quality defect (read first)

The research report (`.pi/research/agent-team-communication-report.md`) states "15 distinct sources" yet enumerates **26 unique URLs** across its body and Sources table. This is a **MEDIUM** evidence-quality defect: the cited body of evidence is broader than the source-count claim, and downstream numeric claims inherit that uncertainty. Rules below that reuse the report's numbers therefore restate them as *"report states X — evidence quality MEDIUM, treat as directional, not authoritative"*. This artifact does **not** claim 90% confidence in any conclusion derived from that report, and the report's headline 90% figure is not propagated forward.

## Role names used in this artifact

Exactly the seven from the brief: **Lead, User, Researcher, Architect, Critic, Reviewer, Engineer**. Lead is the user-facing Pi session (pi-subagents orchestrator). User is the human. The other five match the existing `.pi/agents/*.md` definitions.

---

## 1. Role and decision authority

Authority is assigned per **decision**, not per agent, using a single-accountable-owner rule (RACIs' "A" rule — *report states this is the dominant pattern for AI agent teams; evidence quality MEDIUM*).

| Role | Decides (final) | Advisory only | Cannot decide |
|---|---|---|---|
| **User** | Product scope, irreversible actions, security/data-handling policy, approval to publish artifacts, scope changes that invalidate prior decisions. | — | Anything purely procedural (Lead may execute). |
| **Lead** | Delegation topology, task breakdown, prioritization among agents, *when* to escalate, batching cadence, which Agent-decided items get surfaced. Owns the canonical plan (`plans/<task>.md`). | — | Domain facts inside an agent's specialty — defers to the relevant Agent. |
| **Researcher** | Scope of evidence search, depth choice, which sources to retain, contradictions to record. Final wording of research findings in `.pi/research/`. | Confidence levels, interpretation beyond evidence. | Product decisions; implementation; architecture. |
| **Architect** | Architectural boundaries, interface contracts, data flow, simpler-alternative verdict. Final wording of architecture artifacts in `.pi/research/` (this file is one). | Implementation patterns within an approved design. | Product scope; implementation details outside the artifact. |
| **Critic** | Accept / revise / reject verdict on the artifact under review. Severity ordering of findings. | Design alternatives. | Rewriting the artifact; changing scope. |
| **Reviewer** | Accept / request-changes verdict on code changes. Severity ordering of code/test/scope findings. | Architecture or product decisions. | Editing files (read-only by definition). |
| **Engineer** | Implementation tactics inside an approved plan; file changes; local test runs; validation commands. | Anything that violates approved scope, introduces new dependencies, or changes interfaces. | Architecture; product scope; publishing artifacts. |

**Authority-confusion guard:** any decision touching more than one agent's accountable row triggers Lead's tie-break; if Lead is conflicted, Lead escalates to User via `contact_supervisor` reason `need_decision` or `interview_request`.

---

## 2. Reporting cadence

Cadence is **trigger-driven**, not interval-driven. The Pi `contact_supervisor` reasons are the trigger set (closed enum, three values): `need_decision`, `interview_request`, `progress_update`. (*Report states the closed enum is itself the architectural enforcement of trigger discipline; evidence quality MEDIUM.*)

**Per-agent escalation triggers → Lead**

- **Researcher**: completion of each `research_checkpoint` round (mandatory; never synthesize before PROCEED), plus depth/plan/scope ambiguity (blocking). Non-blocking `progress_update` only on plan change.
- **Architect**: when accepted-decision inventory is altered; when a stable constraint changes; when an unresolved risk is opened or closed.
- **Critic**: on artifact verdict (blocking if accept/reject; non-blocking `progress_update` if revised-pending).
- **Reviewer**: on review verdict for a code change (blocking); on discovery of out-of-scope change (blocking); otherwise only at change-set boundary.
- **Engineer**: on completion of each assigned work item with validation results; on encountering out-of-scope requirement; on test failure that is not locally fixable.

**Lead → User escalation triggers** (any of these force a synchronous interruption, not a batched update):

1. **Scope change** that invalidates a prior approved decision.
2. **Irreversible action** flagged by an agent (deployment, deletion, publication).
3. **Action-risk tier ≥ HIGH** — actions that touch secrets, billing, remote infra, or external users.
4. **Cross-agent recommendation conflict** that Lead cannot reconcile with the RACI precedence rule (Lead > domain specialist > most-recent writer).
5. **Stall > SLO**: any agent blocked > 2× its expected turn budget without a `progress_update`.
6. **Confidence breach**: Researcher reports confidence < 0.6 on a pivotal claim, or evidence-quality defect severity escalates (e.g., MEDIUM → HIGH).

**Lead → User routine cadence** (non-blocking, batched):

- After a phase boundary completes (architecture drafted, research reported, design reviewed, code implemented, tests green).
- One consolidated `progress_update` per phase; intermediate fine-grained updates are suppressed unless plan-changing.
- Final phase: completion summary with artifact paths, decisions taken, and open risks.

**Batching rule:** Lead accumulates up to one phase's worth of non-blocking events into a single Lead→User message. Blocking events are never batched — they preempt.

---

## 3. Direct agent-to-agent messaging

**Default:** no. Routine coordination flows Lead → Agent → Lead. The report states hub-and-spoke is the production-dominant 2026 topology; this artifact adopts that default (*evidence quality MEDIUM*).

**Allowed peer pairs and the message classes they may exchange** (each must still be mirrored to Lead on the next available beat):

| From → To | Allowed message classes | Must surface to Lead |
|---|---|---|
| Engineer ↔ Reviewer | clarification on a specific change, scope-narrowing question, evidence request for a finding | Yes — on next beat or sooner if blocking |
| Engineer ↔ Architect | interface clarification, contract interpretation | Yes |
| Engineer ↔ Critic | scope-of-criticism question, evidence request | Yes |
| Researcher ↔ Architect | evidence availability for an architectural claim, contradiction status | Yes |
| Reviewer ↔ Critic | severity calibration, overlapping-finding merge | Yes |
| Critic ↔ Architect | weakness articulation, alternative-evidence pointer | Yes |
| **Anything ↔ User** | **NOT ALLOWED** — all user contact routes through Lead | Always (Lead is the bridge) |

**Forbidden regardless of pair:** result-of-delegation substitution (a peer completing the bulk of another peer's task), final-approval signaling, scope changes, irreversible-action approvals. These all require Lead.

**Tool surface used:** peer messaging uses `intercom({ action: "send", ... })` (asynchronous, non-blocking, AGENTS.md doc). `intercom({ action: "ask", ... })` is reserved for blocking inter-agent asks that have an explicitly required reply path — used sparingly because it ties up the receiver.

**Mirror-to-Lead rule:** any peer exchange that changes a downstream agent's task definition, exposes a new risk, or invalidates a prior assumption is escalated to Lead immediately (not on next beat). Cosmetic clarifications can wait.

---

## 4. Async non-blocking request/reply lifecycle

Implemented per the AGENTS.md doc: requester sends with `action: "send"` and **does not block**; receiver processes the injected message as a new turn and replies with a second `action: "send"` carrying the originating task/message id in its text for correlation.

**Lifecycle (single message):**

1. **Compose** the envelope (fields per §6). Assign `message_id` (UUIDv4, locally generated; uniqueness is the producer's responsibility, see idempotency key in §7).
2. **Send** with `intercom({ action: "send", to: <peer>, message: <envelope> })`. Tool returns immediately with an injection receipt.
3. **Continue independent work** at the sender — the AGENTS.md doc explicitly forbids blocking on the response.
4. **Receiver** processes the injected envelope as a new turn; replies with a second `send` whose `references.message_id` equals the original `message_id` and whose `kind: "reply"`. Correlation id is also carried in message text per AGENTS.md ("include the originating task or message identifier in the response text").
5. **Sender** treats the reply as a queued turn; updates local state.

**Queue semantics:**

- **Priority levels** (`normal`, `high`, `blocking`) gate FIFO order at the receiver. `blocking` is the same as a `contact_supervisor` `need_decision` and only valid if the receiver has a live reply path. (`*Report states blocking supervisor asks without a reply path fail fast; evidence quality MEDIUM.*`)
- **Starvation avoidance:** a high-priority burst does not preempt in-progress low-priority work; it only reorders the pending queue. A `blocking` message from the User path bypasses pending queue order at the receiver.
- **Backpressure:** if a receiver has > N pending messages from the same sender (proposed N=5), the sender is signaled via a low-priority `kind: "throttle"` reply and is expected to coalesce.
- **Partial-progress visibility:** a long-running agent emits a `kind: "progress"` at meaningful plan-changing checkpoints. Each carries a `progress_percent` and the latest artifact version it observed.

**Scope-change handling for in-flight work:**

- When scope changes (Lead or User initiates), Lead broadcasts `kind: "scope_change"` to all in-flight agents carrying the new `plan_version` and a `supersedes` reference.
- Each in-flight agent acknowledges with `kind: "scope_ack"` and either (a) continues under the new scope if its current work is still valid, (b) cancels and reports a `kind: "cancelled"` with a partial-progress summary, or (c) requests a new task assignment.
- No agent silently continues under the old scope. Stale continuations are surfaced as severity-MEDIUM review findings by Reviewer/Critic on the next beat.

---

## 5. Authoritative artifacts and decision log rules

**Single source of truth (SoT) per artifact class.** Each artifact class has exactly one canonical writer (the role with `A` accountability) and may have any number of readers.

| Artifact class | Path | Writer (A) | Readers | Mutability |
|---|---|---|---|---|
| Plan | `.pi/plans/<task-slug>.md` | Lead | All | Append-only; new plan version = new file or new `## vN` section |
| Research brief | `.pi/research/*.md` (existing convention) | Researcher | All, Lead-distilled to User | Immutable once PROCEED is granted; updates are new files |
| Architecture | `.pi/research/*-architecture.md` | Architect | All | Immutable once Critic-verdict = accept; superseding versions are new files |
| Critic review | `.pi/reviews/critic/<artifact>.md` | Critic | All | Immutable once written; counter-reviews are new files |
| Code-review verdict | inline in PR/commit message or `.pi/reviews/reviewer/<change>.md` | Reviewer | All | Immutable once written |
| Implementation diffs | git, branches per task | Engineer | Reviewer, Critic | Standard git history |
| Decision log | `.pi/decisions/<YYYY-MM-DD>-<slug>.md` (append-only) | Lead on behalf of any decider | All | **Append-only**; never edit past entries |

**Versioning rule:** semantic version `vMAJOR.MINOR` where MAJOR = scope-breaking change, MINOR = additive. Bumping MAJOR requires User approval; bumping MINOR is Lead's call. Every artifact header carries `version:` and `supersedes:` (path of prior version, or `none`).

**Retention:** research and architecture artifacts are retained for the project lifetime. Decision log is retained indefinitely (it is the audit trail). Implementation diffs follow the project's git retention.

**Decision-log entry shape (text only, no code):**

```
# Decision YYYY-MM-DD-NN — <one-line title>

- version: vN (or "initial")
- decider: <role or "User">
- consulted: <roles>
- informed: <roles>
- context: <one-paragraph summary>
- decision: <the choice>
- rationale: <why>
- consequences: <what this enables and what it forecloses>
- supersedes: <prior-decision-id> or none
- open-risks: <ids in the unresolved-risk inventory, if any>
```

---

## 6. Message envelope fields

Identity, correlation, timestamps, sender, recipient, kind, priority, and references only. **No payload hashes, no merkle roots, no content checksums** (per task constraint; also because transport already provides framing).

| Field | Type | Source of truth |
|---|---|---|
| `message_id` | UUIDv4 | Producer; unique within producer scope |
| `correlation_id` | UUIDv4 (or echoes a prior `message_id`) | Producer; carries `request_id` for new conversations and `references.message_id` for replies |
| `causation_id` | UUIDv4 or null | The directly-causing message id (for chain tracing) |
| `created_at` | RFC3339 timestamp, UTC | Producer's clock at compose time |
| `sent_at` | RFC3339 timestamp, UTC | Producer's clock at `intercom` send |
| `received_at` | RFC3339 timestamp, UTC | Receiver's clock when injected as turn (receiver-stamped, not trusted for ordering) |
| `sender` | role handle + session id | Intercom transport |
| `recipient` | role handle or session id | Intercom transport |
| `kind` | enum: `request`, `reply`, `progress`, `decision`, `scope_change`, `scope_ack`, `cancel`, `throttle`, `error`, `heartbeat` | Producer |
| `priority` | enum: `normal`, `high`, `blocking` | Producer |
| `reason` | enum (only when kind ∈ {request}): `need_decision`, `interview_request`, `progress_update`, `clarify`, `evidence_request`, `result`, `status` | Producer; mirrors `contact_supervisor` enum where applicable |
| `subject` | short string (≤80 chars) | Producer |
| `body` | markdown body | Producer |
| `references` | object: `{ message_id?, plan_version?, artifact_path?, artifact_version?, decision_id? }` | Producer |
| `plan_version` | semver string or `none` | Producer |
| `idempotency_key` | UUIDv4 or deterministic hash of (sender + intent + plan_version) — see §7 | Producer |
| `reply_path` | enum: `live`, `none` | Producer; `live` only if the producer will wait synchronously (`ask`-style) |
| `expires_at` | RFC3339 timestamp, UTC | Producer; default = `created_at + 24h` |

**Minimal envelope example** (markdown fenced to be unambiguous; **not** a schema):

```
message_id: 7f3a…
correlation_id: 9b21…
causation_id: null
created_at: 2026-05-04T14:21:09Z
sender: engineer (session e-23)
recipient: architect (session a-04)
kind: request
priority: normal
reason: clarify
subject: confirm retry policy for §8.3
body: Given the proposed retry policy, does the architectural artifact already permit at-least-once delivery, or do I need an explicit envelope field?
references: { plan_version: "v0.3", artifact_path: ".pi/research/agent-team-communication-architecture.md", artifact_version: "v0.3" }
idempotency_key: 2c8e…
reply_path: live
expires_at: 2026-05-05T14:21:09Z
```

**Field-use rules:**

- `reason` is required only for `kind: request`; replies echo the cause's `reason` plus a `resolved` or `deferred` marker.
- `idempotency_key` is required for any message that triggers an action with side effects (artifact writes, file edits, git operations). It is optional for pure-status messages.
- `reply_path: live` is incompatible with `action: "send"` — that combination is rejected by the lifecycle in §4.
- `expires_at` is informational; receivers may use it to evict stale pending messages per §7.

---

## 7. Conflict, staleness, and duplicate handling

**Out-of-order arrivals.** Receivers do not assume causal order from timestamps. A message carrying `references.plan_version` is processed only after the receiver has acknowledged that version; otherwise the message is queued as `pending-version` and re-evaluated on version advance.

**Superseded artifacts.** Every new version declares `supersedes:` in its header and inside message `references.artifact_version`. Receivers holding the prior version treat incoming messages on the prior version as **stale** and respond with `kind: "stale_reference"` plus the current canonical version. Engineers must rebase before continuing; Critics/Reviewers mark stale-finding-derived reviews as `superseded_by: <new artifact version>` and do not act on them.

**Conflicting recommendations from two agents.** Lead applies the precedence rule: **User > Lead > domain-specialist-on-their-domain > domain-specialist-off-domain > most-recent-writer**. On conflict, Lead escalates to User via `need_decision` only if the conflict changes user-visible behavior; otherwise Lead resolves and informs both agents with `kind: "decision"`.

**Duplicate detection.** The transport (intercom) is at-least-once. Every actionable message carries an `idempotency_key`. Receivers keep a short-lived (default 24h) dedup cache keyed on `(idempotency_key, recipient)`. A duplicate is acknowledged with the original reply, not re-processed. `idempotency_key` is the application-level dedup primitive — it is **not** a content hash and is **not** required to be a hash of the payload.

**Retry storms.** Senders that observe `kind: "throttle"` or `kind: "error"` with code `overload` back off exponentially (base 5s, factor 2, max 5 min) and coalesce repeated attempts into a single corrected send. Senders that observe three consecutive `error` replies within a single correlation abandon the request and escalate to Lead with `reason: "need_decision"`.

**Stale-message eviction.** Receivers may drop messages whose `expires_at` has passed without processing; the dropped message is **not** negatively acknowledged. Senders concerned about expiry use `priority: high` and a longer `expires_at`, or `kind: "request"` + `reason: "need_decision"` to force live handling.

**Decision-log conflicts.** Two decisions that contradict: the later decision must declare `supersedes:` pointing to the prior decision id. The decision log itself is append-only — no edit, no deletion. Discovered inconsistencies are recorded as a new decision that names the conflict.

---

## 8. Failure, timeout, and cancellation

**Default timeouts** (defaults; configurable by Lead per phase):

| Message class | Default TTL | Behavior on timeout |
|---|---|---|
| `reason: need_decision` to User | 30 min | Drop the request; Lead coalesces and re-asks or proceeds with documented assumption |
| `reason: interview_request` to User | 60 min | Same as above |
| `reason: progress_update` | none (fire-and-forget) | n/a |
| Peer `request` (default `expires_at`) | 24 h | Receiver may evict; sender retries once with bumped `idempotency_key` |
| `subagent` async launch | task-defined, default 60 min | Engine reports partial state; Lead decides retry/cancel |

**Partial-failure states.** Every async task reports a state vector with at least: `{ started, completed_steps, failed_step, partial_artifact_path, recoverable }`. Reviewer/Critic inspect the partial on any non-clean completion. Engineer never silently restarts a partial without surfacing it.

**Who can cancel what:**

- User can cancel anything.
- Lead can cancel any in-flight agent task (delegated via `subagent` cancel action) or any peer message it originated.
- An agent can cancel **only** its own outbound messages and its own sub-delegations.
- Reviewer and Critic cannot cancel — they issue verdicts only.

**Retry policy.** Idempotent retries allowed up to 3× for transient failures (network, timeout); non-idempotent operations do not auto-retry. After 3 failures, escalate to Lead with `kind: "error" reason: "need_decision"`.

**Dead-letter handling.** Messages that fail processing after the retry budget are written to `.pi/decisions/deadletter/<message_id>.md` with the failure trail, the producer, and the last-known good `plan_version`. Dead-lettered messages are surfaced in the next Lead→User phase summary.

**User-visible degraded modes** (each is a deliberate fallback, not a silent failure):

- *Research unavailable:* Researcher reports partial coverage with explicit gaps; Lead proceeds with reduced-confidence claims flagged.
- *Reviewer unavailable:* Engineer self-validates with documented test commands; Lead marks the change `unreviewed-at-merge` and includes it in next phase summary.
- *Critic unavailable:* Lead skips adversarial pass and adds `unverified-architecture` flag; User decides whether to proceed.
- *Architect artifact stale:* Lead re-requests an architecture refresh before allowing dependent implementation; downstream agents hold.

---

## 9. Staged adoption using installed tools only

Today, the installed substrate is `npm:pi-intercom@0.11.0`, `npm:pi-subagents`, `npm:pi-web-access`. There is **no pub/sub, no blackboard, no external Kafka/Redis topic** installed. Each phase below uses only what is already there.

**Phase 0 — Conventions only (no code, immediate).** Lead writes `.pi/decisions/` and `.pi/plans/` directories with hand-authored entries. Researchers/Architects/Critics write markdown files per the artifact classes in §5. Envelopes (per §6) are pasted into `intercom({ action: "send", message: <envelope-as-text> })`. Decision logging is the only durable mechanism.

**Phase 1 — Envelope discipline + dedup cache (light tooling).** Lead and each agent adopt the §6 envelope shape literally inside `send`/`reply` message text. A short-lived dedup cache (per §7) is maintained by each agent in its own role memory — *no new tool, no new package*. Idempotency keys are generated deterministically from `(sender, intent, plan_version)` to avoid UUID churn.

**Phase 2 — Decision-log append-only writer.** A simple text append-only convention: every decision is a new file in `.pi/decisions/` with the shape in §5. No database, no log server. Reviewer/Critic verify on each phase that no prior decision file has been modified (compare mtimes; flag tampering as severity-HIGH).

**Phase 3 — Cadence + escalation triggers wired.** Lead operationalizes §2 by adopting the closed `contact_supervisor` reason enum (`need_decision`, `interview_request`, `progress_update`) as the *only* way it contacts User. Routine completion returns through `pi-subagents`, **not** `contact_supervisor`, exactly mirroring the report's stated Pi convention (*report states this is the canonical pattern; evidence quality MEDIUM*).

**Phase 4 — Scope-change protocol.** Lead adopts the §4 scope-change broadcast protocol manually: a single `kind: "scope_change"` message with `plan_version` and `supersedes` is sent to every in-flight agent's `intercom` handle. In-flight agents reply with `scope_ack`. This is a convention, not a tool.

**Phase 5 — Degraded-mode declarations.** Each agent's role memory gains a short "degraded mode" section. Lead reads these at the start of each phase to know which degraded modes are currently active. No new tooling.

**Not in any phase (deliberately deferred until a real gap is observed):**

- A pub/sub or blackboard layer (would require new tooling not installed).
- A CRDT runtime (would require new tooling not installed).
- Application-level payload integrity fields (deliberately omitted per task; transport framing is sufficient).

---

## Decisions requiring user choice

1. **Precedence on cross-cutting decisions.** (§1, §7)
   - **A.** User > Lead > domain-specialist (on-domain) > domain-specialist (off-domain) > most-recent-writer — *recommended; matches RACI single-A pattern.*
   - **B.** User > most-recent-writer — *simpler but allows stale domain knowledge to override a domain specialist.*
   - **C.** Domain-specialist is final on any claim touching their specialty — *gives more autonomy to agents but increases conflict rate.*

2. **Default timeouts.** (§8)
   - **A.** Need-decision 30 min, interview 60 min, peer request 24 h — *proposed default.*
   - **B.** All user-blocking = 60 min, peer request 24 h — *more forgiving, slower.*
   - **C.** Need-decision 15 min, interview 30 min, peer request 4 h — *forces faster resolution, higher escalation rate.*

3. **Idempotency-key generation.** (§6, §7)
   - **A.** Deterministic `(sender, intent, plan_version)` — *recommended; reproducible, easy to dedup across sessions.*
   - **B.** Random UUIDv4 per send — *simpler, but requires a separate dedup index persisted across restarts.*
   - **C.** Hybrid: deterministic for retries of the same logical send, UUIDv4 for genuinely new sends.

4. **Decision-log retention.** (§5)
   - **A.** Indefinite (recommended — matches audit-trail role).
   - **B.** Rolling 1-year retention.
   - **C.** Indefinite for product/scope/security decisions; 1-year rolling for procedural.

5. **Scope-change broadcast: who receives?** (§4)
   - **A.** All in-flight agents — *recommended; matches §4.*
   - **B.** Only directly-affected agents (Lead decides affected set) — *smaller blast radius, more Lead judgment.*
   - **C.** Agents + Reviewer + Critic (read-only recipients) — *wider situational awareness but more traffic.*

6. **Peer-messaging mirror rule latency.** (§3)
   - **A.** Surface on next beat (recommended).
   - **B.** Immediate surface for any change to a downstream task.
   - **C.** Immediate surface for any non-cosmetic exchange.

7. **Degraded-mode policy when Critic is unavailable.** (§8)
   - **A.** Proceed with `unverified-architecture` flag, included in next phase summary — *recommended.*
   - **B.** Block until Critic is available.
   - **C.** Substitute Reviewer for the adversarial pass (semantic mismatch but provides a second pair of eyes).

---

## Residual risks (could not resolve within scope)

- **MEDIUM.** No authoritative definition of the Lead's `intercom` handle or session-id discovery mechanism is present in the agent definition files (only Researcher/Architect/Engineer have `contact_supervisor`). Lead's discovery procedure for peer sessions (`intercom list-cwd`) is documented in AGENTS.md but the convention for naming the Lead's own handle is not — this artifact recommends `lead` but that is a convention, not an enforcement.
- **MEDIUM.** The pi-subagents `contact_supervisor` reason enum is closed in the report's reading but is third-party (community package) and may evolve. Pinning versions is recommended but not specified here.
- **MEDIUM.** Evidence-quality defect on the underlying research (26 URLs vs claimed 15 sources) propagates to every numeric claim reused above. Anything derived from "production dominance" percentages, cadence heuristics, or trigger-coverage claims carries this defect.
- **LOW.** No concrete UX for the User→Lead `interview_request` exists in the substrate today — it is reported as an enum value but not demonstrated. Whether the user can answer a structured multi-option question interactively vs. as freeform prose is unclear.
- **LOW.** Conflict-resolution precedence (§1, §7) has not been exercised against a real cross-cutting decision in this project; the chosen precedence order is principled, not empirically validated.
- **LOW (out of scope for this artifact).** Decision-log tampering detection in Phase 2 relies on file mtime, which is trivially forgeable; a real audit guarantee would require git-signed commits or an external WORM store. Mentioned for completeness; not addressed.
