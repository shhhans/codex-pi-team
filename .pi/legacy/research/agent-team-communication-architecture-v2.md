# Agent Team Communication Architecture (v2)

- **Status:** superseding architecture — design proposal, read-only analysis
- **Supersedes:** `.pi/research/agent-team-communication-architecture.md` (v1)
- **Governs:** agent-team communication from this version forward
- **Audience:** Lead (= Codex, see §2), User (decision owner)
- **Source of truth for decisions:** `.pi/decisions/2026-08-21-agent-team-communication-baseline.md` (accepted 2026-08-21-01). Every item in that decision is treated as fixed ground truth, not as a menu, throughout this artifact.

> **Evidence-quality carryover.** The underlying research report (`.pi/research/agent-team-communication-report.md`) claims 15 sources yet enumerates 26 unique URLs. This is a **MEDIUM** evidence-quality defect. Numeric and adoption claims reused below from that report are flagged inline as "report states X — evidence quality MEDIUM, treat as directional". The report's 90% headline confidence is not propagated forward.

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

### 1.2 What v2 preserves from v1

- Hub-and-spoke by default with bounded peer escape hatches (baseline items 1, 3, 4).
- Per-decision RACI single-A accountability (baseline item 1, plus the corrected precedence rule).
- Async non-blocking request/reply lifecycle based on `intercom({ action: "send" })` and per-session correlation id in message text (AGENTS.md).
- Decision log at `.pi/decisions/<YYYY-MM-DD>-<slug>.md`, append-only, with `supersedes:` on contradictions (baseline).
- Mirror-to-Lead rule (baseline item 7).
- Scope-change handling using mark-stale / cancel / preserve-partial / restart under a new plan version (baseline item 9).
- Six-signal HITL escalation set (confidence breach, action-risk tier, frustration, SLA-approaching, irreversibility, anomaly/injection) as the descriptive trigger taxonomy that informs Lead→User escalation triggers (§3).
- Researcher round-gating via `research_checkpoint` (already in the Researcher agent definition).

### 1.3 What v2 does NOT change (baseline is fixed)

- Codex is the sole Lead (§2, baseline item 1).
- Hub-and-spoke by default with the bounded peer pairs in baseline item 4.
- Reviewer→Lead-only during initial rollout (baseline item 5).
- Critic and Reviewer may use `contact_supervisor` only for risk and verdict escalation (baseline item 6) — see §4.2 for the corrected escalation wiring.
- Mirror-to-Lead rule and its immediate-vs-deferred split (baseline item 7).
- One UUID per logical request, reused on retry (baseline item 8; see §5).
- Scope-change protocol (baseline item 9; see §6).
- Critic-unavailable degraded mode (baseline item 10; see §9).

### 1.4 What v2 explicitly does NOT claim

- v2 does NOT claim that intercom is currently exposed to any agent role.
- v2 does NOT claim that `contact_supervisor` is currently exposed to Critic or Reviewer.
- v2 does NOT claim live parent-to-child broadcast as a current capability.
- v2 does NOT claim cryptographic, WORM, or hash-chain tamper detection.
- v2 does NOT invent new `contact_supervisor.reason` enum members.

---

## 2. Glossary

| Term | Definition in v2 | Notes |
|---|---|---|
| **Lead** | **Codex**, the user-facing session. The only role that communicates directly with the User. | Per baseline item 1. **Not** a Pi subagent. Codex is the parent Pi session in the `pi-subagents` model but the user-facing persona is Codex. |
| **Codex Lead** | Synonym for Lead in this artifact. | Used for clarity when referring to the runtime session identity vs. the role. |
| **User** | The human. Receives ordinary Codex conversation from Lead. Does not participate in `intercom` or `contact_supervisor`. | Per baseline correction: Lead-to-User communication is ordinary Codex conversation, NOT `contact_supervisor`. |
| **Subagent** | A Pi subagent session launched by `pi-subagents`. Subagents are the Researcher, Architect, Engineer, Critic, and Reviewer roles. | Each subagent runs in its own session with the role's tool surface defined in `.pi/agents/<role>.md`. |
| **Peer** | Any other live Pi session reachable via `intercom`. In this project's rolled-out topology, peers are: Researcher, Architect, Engineer, Critic, Reviewer (subject to the bounded pairs in baseline item 4). | Codex Lead participates as a peer when addressed by a subagent's `intercom send`, but Lead is not reached via `contact_supervisor`. |
| **`intercom`** | The runtime tool registered by the `npm:pi-intercom` extension. Actions: `list`, `list-cwd`, `send`, `ask`, `reply`, `pending`, `status`, `cancel` (verified at `node_modules/pi-intercom/index.ts:1827`). | NOT listed in any agent definition's `tools:` field today. Wiring is a runtime concern (see §4.1). |
| **`contact_supervisor`** | The runtime tool registered by `npm:pi-intercom` extension **only when `pi-subagents` supplies child bridge metadata**. Verified enum: `reason ∈ {"need_decision", "progress_update", "interview_request"}` (`node_modules/pi-intercom/index.ts:1543`). | NOT visible to normal parent Pi sessions. NOT in Critic's or Reviewer's tool list today. |
| **Logical request** | One piece of work the originator intends to be done once. Identified by exactly one UUID generated at origination and reused for every retry (§5). | Distinct from a single `intercom send` invocation, which may be at-least-once delivered. |
| **Correlation id** | A UUID carried in the message text of an `intercom send` reply so the receiver can match the reply to the originating logical request. | Convention from AGENTS.md: "include the originating task or message identifier in the response text." |
| **Currently working — evidenced** | A capability that is installed in `.pi/settings.json` and/or in `node_modules/pi-intercom/index.ts` and is reachable by the role that needs it today. | See §8.1. |
| **Designed but unproven — requires empirical test** | A capability described by this architecture whose runtime behavior has not been observed end-to-end on this project. | See §8.2. Must pass the acceptance matrix in §10 before being relied on. |

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
| **Subagent ↔ Peer (bounded)** | Both ways | `intercom({ action: "send" })` non-blocking; `intercom({ action: "ask" })` blocking | Bounded pairs per baseline item 4, with mirror-to-Lead per baseline item 7. | Replies use `intercom({ action: "send" })` with the originating task id in text. |
| **Lead ↔ Subagent (mirror back)** | Both ways | `intercom({ action: "send" })` | When Codex Lead is reachable as a peer or needs to relay a mirrored message. | v2 does not require this; it is the only Lead↔subagent path after the original task assignment. |

### 3.3 `contact_supervisor` — the closed enum

The `contact_supervisor.reason` field is a closed enum. The verified values from the installed package (`node_modules/pi-intercom/index.ts:1543`) are:

| Value | Blocking? | Required payload | Used for |
|---|---|---|---|
| `need_decision` | **Yes** (waits for reply; fails fast if no live reply path) | `message: string` (required) | Single blocking clarification, approval gate, or scope question that requires a reply before the subagent can continue. |
| `interview_request` | **Yes** (waits for reply) | `interview: { title?, description?, questions: [{ id, type, question, options?, context? }] }` where `type ∈ {"single", "multi", "text", "image", "info"}` | Multiple structured questions to Lead in one blocking exchange. |
| `progress_update` | **No** (fire-and-forget) | `message: string` (required) | Meaningful plan-changing progress or unexpected discoveries. **Not** for routine completion. |

**Extension protocol for closed-enum compliance.** v2 does NOT add new enum members. To carry structured information beyond the closed enum, subagents use:

1. The `interview` payload field for `interview_request` (this field is in the installed schema).
2. A **namespaced free-form prefix** in the `message` string for `need_decision` and `progress_update`. Example convention: `code:decision/v1; plan:v0.3; artifact:.pi/research/x.md@v0.2; body:<one-line question>`. The runtime ignores everything before the first `;` other than the verb marker; Lead parses the prefix as a hint, not as a contract.
3. The same UUID-reuse rule for `progress_update` as for `request` (§5).

**Forbidden extensions:** inventing new enum members (`reason: "blocking"`, `reason: "warning"`, `reason: "cancel"`, etc.); adding a sibling field that the runtime does not recognize; encoding priority in the `reason` field.

### 3.4 Peer messaging envelope (text conventions, not envelope schema)

The installed `intercom({ action: "send", to: ..., message: ... })` accepts a single text message. v2 specifies **text conventions**, not envelope-schema fields, because no structured envelope schema is part of the substrate today.

Recommended text shape (markdown fenced, **not** a schema, used for human readability and grep-ability):

```
id: <UUID — the logical-request UUID, reused on retry>
correlation_id: <UUID — same as id on first send; echoes id on reply>
kind: request | reply | error | progress
references: { plan_version?: vN, artifact_path?: <path>, artifact_version?: vN, decision_id?: YYYY-MM-DD-NN }
subject: <short summary, ≤80 chars>
body: <the message>
```

Rules:

- `id` is the §5 idempotency UUID. **Same UUID on every retry of the same logical request.**
- `kind` is one of `request`, `reply`, `error`, `progress`. Replies echo the originating `correlation_id` in the body prefix per AGENTS.md.
- `references.artifact_version` is the version label the sender saw at compose time. Receivers on a newer version reply with `kind: "error"` plus a `stale_reference` note and the current canonical version.
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

`intercom` is registered by the `npm:pi-intercom` extension at runtime, **not** declared in agent definitions. Whether each role's runtime sees the `intercom` tool depends on the runtime's allowlist for that session. v2 does not assume that allowlist is currently expanded to include Critic, Reviewer, or any specific peer pair.

**v2 explicitly does not claim `intercom` is currently exposed to any agent role.** v2 specifies how exposure is to be achieved; whether it is achieved today is verified by the acceptance matrix in §10.

### 4.2 How `intercom` is exposed to each role that needs it

Agent definitions in `.pi/agents/` are immutable for this design exercise (baseline correction: "Agent definitions ... are authoritative and immutable for design exercises"). Wiring therefore happens in the **runtime allowlist**, not in agent files.

| Role | Needs `intercom`? | Wiring mechanism (runtime, not agent file) |
|---|---|---|
| **Lead (Codex)** | Yes — to mirror messages, to surface escalations from Critic/Reviewer that arrive via intercom, and to act as a peer when subagents mirror. | Codex Lead must run in a session where the `intercom` tool is registered. Today this is **not** configured for Codex (Codex is not a Pi session). Wiring requires runtime configuration that is OUT OF SCOPE for v2 to prescribe in code; v2 requires the acceptance test AT-LEAD-MIRROR (§10) to demonstrate the wiring works before rollout. |
| **Architect** | Yes — for Architect ↔ Critic and Architect ↔ Researcher peer exchanges (baseline item 4). | Architect already has `contact_supervisor`. Adding `intercom` requires the runtime allowlist to register it for the Architect session. This is a runtime change, not an agent-definition edit. |
| **Researcher** | Yes — for Researcher ↔ Architect peer exchanges (baseline item 4). | Same runtime-allowlist requirement as Architect. |
| **Critic** | Yes — Critic needs an escalation channel because it has no `contact_supervisor` (§4.3). | Same runtime-allowlist requirement. Without this wiring, Critic's only escalation path is report-as-artifact (§4.3). |
| **Reviewer** | Yes — same as Critic (§4.3). | Same runtime-allowlist requirement. |
| **Engineer** | Yes — for Engineer ↔ Reviewer and Engineer ↔ Architect peer exchanges. | Same runtime-allowlist requirement. |

**v2 statement:** the wiring above is a **requirement**, not a current capability. The acceptance matrix (§10) gates rollout on empirical demonstration that the allowlist is configured for each role that needs it; until that gate is passed, peer messaging between any two roles must be considered **unproven**.

### 4.3 Critic and Reviewer escalation when `contact_supervisor` is absent

Critic and Reviewer have no `contact_supervisor` in their tool list (verified at `.pi/agents/critic.md` and `.pi/agents/reviewer.md`), and `acceptanceRole: read-only` rules out the write tools that would let them trigger other escalation channels. This is a real coverage gap. v2 specifies two escalation paths and orders them:

**Path 1 — Peer intercom escalation (preferred, requires wiring in §4.2).**
When the runtime allows Critic/Reviewer to register `intercom`, the escalation is:

```
intercom({ action: "send", to: "lead", message: "[escalation] id:<UUID> kind:request subject:<one-line> body:<the blocker>" })
```

This is non-blocking (fire-and-forget). The Critic/Reviewer continues independent work after the send. Lead receives the message as an injected turn on the next available beat and responds with a second `intercom({ action: "send", to: "<critic-or-reviewer-session>", message: "..." })` carrying the correlation id.

**Path 2 — Report-as-artifact escalation (fallback, always available).**
Critic/Reviewer writes a verdict or escalation file under `.pi/reviews/critic/<artifact>.md` or `.pi/reviews/reviewer/<change>.md` and surfaces it in the verdict. Lead is expected to read `.pi/reviews/**` at the start of each phase boundary. This is the lowest-common-denominator escalation path; it works today without any runtime wiring change.

**Ordering rule:** Path 1 is preferred for blocking escalations (Critic's `accept`/`reject` verdict is blocking per v1 §2). Path 2 is acceptable for non-blocking findings. If Path 1's wiring is not in place when the next Critic/Reviewer cycle runs, Path 2 is used and the missing wiring is recorded as an open risk (§11).

**Why `intercom({ action: "ask" })` is not used here.** `ask` is blocking. Critic and Reviewer are read-only roles; a blocking ask would tie up the Critic/Reviewer turn. v2 keeps escalation non-blocking and routes the blocking behavior to Lead's response, not to the Critic/Reviewer.

### 4.4 Pair allowlist and mirror rule

Baseline item 4 fixes the bounded peer pairs for the initial rollout:

- Researcher ↔ Architect
- Architect ↔ Critic
- All other pairs route through Lead.

Baseline item 7 fixes the mirror rule: any peer exchange that changes downstream work, exposes a new material risk, or invalidates an accepted assumption is mirrored to Lead **immediately**; cosmetic clarifications can wait for the next phase boundary.

v2 adds the following operational rule:

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

The receiver keeps a short-lived (default 24 h) dedup cache keyed on `(idempotency_key, recipient)`. A duplicate is acknowledged with the **original reply**, not re-processed. The cache is per-recipient and lives in the receiver's role memory, not in a shared substrate (no pub/sub, no blackboard — see baseline).

**The receiver MUST also dedup on the originating-message UUID when it is not the idempotency key.** For example, when an `intercom send` arrives carrying `id: <UUID>` in the message text, the receiver first looks up `<UUID>` in its dedup cache; if found, the receiver replays the cached reply instead of re-processing.

### 5.5 What this replaces

- v1's `idempotency_key: UUIDv4 or deterministic hash of (sender + intent + plan_version)` — removed.
- Any "hash the payload" rule — forbidden.
- Any "increment a counter" rule — forbidden.

---

## 6. Scope-change protocol

### 6.1 The protocol (corrected)

Per baseline item 9: **scope changes use mark-stale, cancel or reach a safe boundary, preserve partial results, and restart under a new plan version. Do not assume live parent-to-subagent broadcast exists.**

The protocol:

1. **Decide.** The scope change is decided by User, Lead, or by an accepted escalation. The decision is logged to `.pi/decisions/<YYYY-MM-DD>-scope-<slug>.md` with the new `plan_version`, `supersedes:` pointing to the prior version, and a description of the change.
2. **Mark stale.** Lead updates the canonical plan with the new `plan_version`. Any artifact written under the old `plan_version` is marked stale by appending a `STALE-AS-OF:<new-plan-version>` note to the file's header. Stale artifacts are still readable but cannot be cited as authoritative.
3. **Cancel or reach safe boundary.** For each in-flight subagent, Lead decides between (a) cancel and (b) let the subagent reach its current safe boundary.
   - **Cancel**: Lead uses `intercom({ action: "cancel", to: "<subagent-session>" })` (verified action in the installed enum, `node_modules/pi-intercom/index.ts:1827`). The subagent reports its `partial_artifact_path` and stops.
   - **Safe boundary**: Lead allows the subagent to finish its current step, then issues the cancel at the boundary.
4. **Preserve partial results.** Each cancelled subagent writes its `partial_artifact_path` to its own role memory and to `.pi/decisions/<...>-cancellation-<slug>.md` as a brief log entry.
5. **Restart.** Lead re-launches the affected subagents under the new `plan_version`. The new task payload references the preserved partial result.

### 6.2 What this replaces in v1

- v1 §4 "scope_change broadcast to all in-flight agents carrying the new plan_version" — removed. The protocol is mark-stale-then-cancel-then-restart, not live broadcast. This matches baseline item 9's "do not assume live parent-to-subagent broadcast exists."
- v1 §4 "scope_ack" reply kind — removed.

### 6.3 Empirical test

The cancellation/restart leg of this protocol is gated on acceptance test AT-CANCEL (§10).

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

### 7.2 What v2 does NOT claim

- v2 does **NOT** claim cryptographic integrity, WORM storage, append-only enforcement by the filesystem, or hash-chained audit trails.
- v2 does **NOT** claim `mtime` as a tamper signal (mtime is trivially forgeable).
- v2 does **NOT** claim tamper-proof storage of any kind.

### 7.3 What v2 does claim

- v2 claims that **git history, reviewed by a human, is the audit mechanism** for the decision log. This is a social-process claim, not a cryptographic one.

---

## 8. Capability split: evidenced vs. unproven

### 8.1 Currently working — evidenced

Each row is verified by direct inspection of the installed substrate (`.pi/settings.json` or `node_modules/pi-intercom/index.ts`). No row here depends on agent-definition edits.

| # | Capability | Evidence | Notes |
|---|---|---|---|
| C1 | `intercom` tool is registered at runtime by the `npm:pi-intercom` extension. | `node_modules/pi-intercom/index.ts:1827` defines the tool with `action` enum `["list", "list-cwd", "send", "ask", "reply", "pending", "status", "cancel"]`. | Verified presence in package source. Which sessions see it at runtime is **not** evidenced here — see §8.2. |
| C2 | `contact_supervisor` tool is registered at runtime by `npm:pi-intercom` **only when `pi-subagents` supplies child bridge metadata**. | `node_modules/pi-intercom/index.ts` registers `contact_supervisor` only inside `if (childOrchestratorMetadata && !nativeSupervisorChannelAvailable)` (verified at lines ~1530-1540). | Normal parent Pi sessions do NOT see `contact_supervisor`. |
| C3 | `contact_supervisor.reason` is a closed enum with exactly three values: `need_decision`, `progress_update`, `interview_request`. | `node_modules/pi-intercom/index.ts:1543` declares `StringEnum(["need_decision", "progress_update", "interview_request"] as const, {...})`. | The runtime rejects other values; v2 does not invent new members. |
| C4 | `contact_supervisor.interview` payload schema (for `interview_request`) is `interview: { title?, description?, questions: [{ id, type, question, options?, context? }] }` with `type ∈ {"single","multi","text","image","info"}`. | `node_modules/pi-intercom/index.ts:1554`. | This is the v2 extension mechanism for structured escalation. |
| C5 | `intercom({ action: "send" })` is non-blocking (verified by the AGENTS.md convention and by the package returning synchronously after `client.send(...)`). | `AGENTS.md` codifies the async pattern. | "include the originating task or message identifier in the response text." |
| C6 | `intercom({ action: "ask" })` is the only blocking peer primitive. | `node_modules/pi-intercom/index.ts:1818` defines `ask`; AGENTS.md says reply is the matching primitive. | `reply` resolves `ask`, not `send`. |
| C7 | The decision-log location convention `.pi/decisions/<YYYY-MM-DD>-<slug>.md` is followed by the existing baseline file. | File present at `.pi/decisions/2026-08-21-agent-team-communication-baseline.md`. | Convention is observed, not enforced. |
| C8 | Substrate constraint: only `npm:pi-intercom`, `npm:pi-subagents`, `npm:pi-web-access` are installed. | `.pi/settings.json`. | No pub/sub, no blackboard, no external Kafka/Redis. |
| C9 | Agent tool surfaces are fixed (architect, critic, engineer, researcher, reviewer — none has `intercom` in `tools:`; critic and reviewer have no `contact_supervisor`). | `.pi/agents/*.md` frontmatter. | Verified 2026-08-21. |
| C10 | `pi-subagents` returns subagent results to the parent session on completion (routine completion does not cross `contact_supervisor`). | Per `npm:pi-intercom` README: "Do not use `contact_supervisor` for routine completion handoffs. Return the final subagent result normally through `pi-subagents`." | Convention observed by the reference implementation. |

### 8.2 Designed but unproven — requires empirical test

Each row is part of v2's design but is **not** verified by inspection of the installed substrate today. Each row maps to one or more acceptance tests in §10.

| # | Capability | Why unproven | Required test |
|---|---|---|---|
| U1 | `intercom` is exposed to Architect, Engineer, Researcher sessions at runtime. | Agent `tools:` fields do not list `intercom`; runtime allowlist is not documented. | AT-ALLOWLIST-EXP |
| U2 | `intercom` is exposed to Critic and Reviewer sessions at runtime (so they can escalate via Path 1 in §4.3). | No runtime wiring is in any installed file. | AT-ALLOWLIST-EXP, AT-CRITIC-ESC, AT-REVIEWER-ESC |
| U3 | `intercom({ action: "list-cwd" })` returns the expected peer set (Critic/Reviewer/Architect/Engineer/Researcher) for each role that has it. | Tool is registered; the runtime's peer-discovery output has not been observed. | AT-DISCOVERY |
| U4 | `intercom({ action: "send" })` returns without blocking the sender. | Documented by AGENTS.md; not observed end-to-end on this project. | AT-ASYNC-SEND |
| U5 | A reply to a `send` carries the originating task id in its text such that the sender can correlate. | AGENTS.md specifies the convention; round-trip is not observed. | AT-CORRELATION |
| U6 | Codex Lead receives an `intercom`-bound mirror and does not confuse it with ordinary Codex conversation. | No demonstration exists in this project. | AT-LEAD-MIRROR |
| U7 | `contact_supervisor({ reason: "need_decision" })` from Architect / Engineer / Researcher reaches Lead. | Tool is registered only under child-bridge-metadata; not exercised. | AT-SUPERVISOR-ESC |
| U8 | Cancellation of an in-flight subagent via `intercom({ action: "cancel" })` does not leak orphan state. | Action exists; orphan-leak behavior is not characterized. | AT-CANCEL |
| U9 | A duplicate `intercom send` carrying the same logical-request UUID is deduped by the receiver (no duplicate processing, original reply replayed). | Convention documented; not exercised. | AT-DEDUP |
| U10 | A peer NOT in the bounded-pair allowlist is rejected when it attempts to send to a peer that should not be in its allowlist. | Bounded-pair rule is in the baseline; runtime enforcement is not characterized. | AT-UNAUTH-PAIR |
| U11 | The decision-log tamper-detection method (git history review) actually surfaces a synthetic out-of-band edit when one is introduced in a test fixture. | Process claim; not exercised. | AT-TAMPER (process test) |
| U12 | The scope-change protocol (mark-stale, cancel/safe-boundary, preserve-partial, restart) works without orphan tasks. | Per baseline item 9: do not assume live broadcast exists. The protocol is correct in design but its behavior is unverified. | AT-CANCEL |
| U13 | The Critic/Reviewer Path-1 escalation (intercom to Lead) reaches Lead and is acted on. | Wiring is unproven; without wiring, only Path 2 (report-as-artifact) is exercised. | AT-CRITIC-ESC, AT-REVIEWER-ESC |

### 8.3 Capability-state matrix (at a glance)

| Capability | Working | Unproven | Test gating |
|---|---|---|---|
| `intercom` registered | ✓ (C1) | — | — |
| `intercom` exposed to a specific role's session | — | ✓ (U1, U2) | AT-ALLOWLIST-EXP |
| Peer discovery via `list-cwd` | — | ✓ (U3) | AT-DISCOVERY |
| Async `send` non-blocking | — | ✓ (U4) | AT-ASYNC-SEND |
| Correlation id round-trip | — | ✓ (U5) | AT-CORRELATION |
| Codex Lead mirroring | — | ✓ (U6) | AT-LEAD-MIRROR |
| Subagent → Lead escalation via `contact_supervisor` | — | ✓ (U7) | AT-SUPERVISOR-ESC |
| Critic/Reviewer escalation via `intercom` to Lead | — | ✓ (U2, U13) | AT-CRITIC-ESC, AT-REVIEWER-ESC |
| Cancellation without orphan | — | ✓ (U8, U12) | AT-CANCEL |
| Duplicate dedup by logical-request UUID | — | ✓ (U9) | AT-DEDUP |
| Unauthorized peer pair rejection | — | ✓ (U10) | AT-UNAUTH-PAIR |
| Git-history tamper detection | ✓ (process, C7) | ✓ (U11) | AT-TAMPER |

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

Every row is a runnable scenario. "Setup" is the precondition. "Action" is the exact tool invocation or scenario trigger. "Expected result" is the observable behavior. "Observe pass/fail" is the verification step. All tests are gated on v2 rollout; no test is considered passed by v2 alone.

### 10.1 Test table

| Test ID | Setup | Action | Expected result | Observe pass/fail |
|---|---|---|---|---|
| **AT-ALLOWLIST-EXP** | A Pi session is launched for each role (architect, critic, engineer, researcher, reviewer). | For each role, the launched session inspects its registered tools (e.g., by listing the tools its system prompt advertises, or by attempting an `intercom({ action: "list" })` call). | Architect, Engineer, Researcher: `intercom` is in the registered tool list. Critic, Reviewer: `intercom` is in the registered tool list **only after** the runtime allowlist is expanded. Until then, the test FAILS for Critic/Reviewer and the missing wiring is recorded as an open risk. | Pass = each required role sees `intercom`. Fail = a required role does not see `intercom` and the gap is recorded. |
| **AT-DISCOVERY** | AT-ALLOWLIST-EXP has passed for the role under test. | From each role's session, run `intercom({ action: "list-cwd" })`. | The returned peer list contains exactly the bounded pairs allowed by baseline item 4 for that role, plus the Lead peer if Lead is reachable from that session. No unallowed peer is returned. | Pass = peer set matches baseline item 4. Fail = unexpected peer or missing required peer. |
| **AT-ASYNC-SEND** | Two Pi sessions live in the same cwd; sender has `intercom` registered. | Sender runs `intercom({ action: "send", to: "<receiver>", message: "id:<UUID> kind:request subject:ping body:hello" })`. Wall-clock the call. | The `send` tool call returns within ≤2 s regardless of whether the receiver is currently processing. | Pass = call returns immediately. Fail = call blocks >2 s. |
| **AT-CORRELATION** | AT-ASYNC-SEND has passed. | Receiver injects the message as a turn and replies with `intercom({ action: "send", to: "<sender>", message: "id:<UUID-of-reply> correlation_id:<UUID-from-original> kind:reply references:{message_id:<UUID-from-original>} body:<reply>" })`. | The sender receives the injected reply; the `correlation_id` in the reply text matches the `id` of the original send; the sender can pair the reply to the original. | Pass = ids match end-to-end. Fail = id drift. |
| **AT-NON-BLOCK-SENDER** | Two Pi sessions live; sender has work pending after the send. | Sender runs `intercom({ action: "send", to: "<peer>", message: "id:<UUID> kind:request subject:queue-test body:..." })` and then immediately performs an independent tool call (e.g., `read` of a local file). | Sender's `read` returns successfully before any reply from the peer arrives. The send is non-blocking in the sender's tool-result stream. | Pass = `read` completes pre-reply. Fail = sender waits. |
| **AT-LEAD-MIRROR** | A subagent (Architect) is delegated a task by Lead (Codex). Lead is reachable as a peer in the runtime. | Architect, on completing a step that mirrors to Lead (per baseline item 7), runs `intercom({ action: "send", to: "lead", message: "id:<UUID> kind:request subject:mirror references:{plan_version:v0.3} body:<the mirrored content>" })`. | Lead's Codex conversation stream receives the mirror as a clearly-labeled intercom-bound message (e.g., prefixed with `[intercom-mirror]`) and does not treat it as an ordinary Codex turn from the User. Lead reads the mirror, decides, and continues. | Pass = mirror is distinguishable from user input. Fail = mirror is conflated with user input or is silently dropped. |
| **AT-SUPERVISOR-ESC** | Architect (or Engineer or Researcher) subagent has been delegated a task and is blocked on a product/API/scope decision. | The subagent runs `contact_supervisor({ reason: "need_decision", message: "id:<UUID> kind:request subject:scope-decision body:<the question>" })`. | Lead (Codex) receives the escalation as a structured event distinguishable from ordinary Codex conversation. The subagent's tool call blocks until Lead replies (via the runtime's reply path) or fails fast with a clear "no live reply path" error if Lead is not reachable. | Pass = escalation reaches Lead and reply returns to the subagent. Fail = silent drop or wrong channel. |
| **AT-CRITIC-ESC** | Critic has produced a `reject` verdict that includes a blocker. Critic's runtime allowlist does include `intercom` (else Path 2 is used and the test result is recorded as a wiring gap). | Critic runs `intercom({ action: "send", to: "lead", message: "id:<UUID> kind:request subject:critic-escalation references:{artifact_path:..., artifact_version:...} body:<the blocker>" })`. | Lead (Codex) receives the escalation (per AT-LEAD-MIRROR pass criteria) and treats it as a blocking finding. | Pass = Critic escalation reaches Lead. Fail = escalation lost; Path 2 (report-as-artifact) is used and the missing wiring is recorded. |
| **AT-REVIEWER-ESC** | Reviewer has produced a `request-changes` verdict on a code change. | Reviewer runs `intercom({ action: "send", to: "lead", message: "id:<UUID> kind:request subject:reviewer-escalation references:{change:<id>} body:<the blocker>" })`. | Lead (Codex) receives the escalation (per AT-LEAD-MIRROR pass criteria). | Pass = Reviewer escalation reaches Lead. Fail = fallback to inline-in-PR or verdict file; the wiring gap is recorded. |
| **AT-CANCEL** | An Engineer subagent is running a long task under `plan_version: v0.3`. Lead decides to cancel and re-launch under `plan_version: v0.4`. | Lead runs `intercom({ action: "cancel", to: "<engineer-session>" })`. | Engineer's subagent receives the cancel, writes `partial_artifact_path` to its role memory, and stops. No orphan background tasks remain. Engineer then re-launches under the new `plan_version` and references the partial result. | Pass = no orphans; partial result is preserved; re-launch picks up the partial. Fail = orphaned task or lost partial result. |
| **AT-DEDUP** | Receiver has a dedup cache populated with `<UUID>` from a prior send. | Sender retries the same logical request with the **same** `id:<UUID>` in the message text. | Receiver's `intercom({ action: "send", ... })` returns; the receiver injects a turn that detects the duplicate via the UUID and replays the cached original reply instead of re-processing. No second side-effect occurs. | Pass = exactly one side-effect; second send is acknowledged with the original reply. Fail = second send is re-processed. |
| **AT-UNAUTH-PAIR** | Critic and Engineer are NOT in the bounded-peer allowlist for the initial rollout (baseline item 4). | Critic attempts `intercom({ action: "send", to: "engineer", message: "..." })`. | The runtime rejects the send with an "unauthorized peer" or "peer not in allowlist" error. Critic does NOT see Engineer in `intercom({ action: "list-cwd" })`. | Pass = send is rejected; Engineer not in Critic's peer list. Fail = send is silently accepted or delivered. |
| **AT-TAMPER** | A test fixture introduces an out-of-band edit to a synthetic decision-log file under `.pi/decisions/`. | A reviewer runs `git log --follow --diff-filter=AM --pretty=format:"%h %ad %s" -- .pi/decisions/<fixture>.md` and `git log -p -- .pi/decisions/<fixture>.md`. | The out-of-band edit is visible in the diff. The reviewer can detect and report it. | Pass = edit is visible to a human reviewer. Fail = edit is invisible to git history (i.e., the fixture was bypassed). |

### 10.2 Acceptance gate

v2 is considered rolled out **only when** all 13 acceptance tests pass. Until then:

- Peer messaging between any two roles must be considered **unproven**.
- The Critic and Reviewer Path-1 escalation (§4.3) is **unproven**; Path 2 (report-as-artifact) is the only proven fallback.
- The scope-change cancellation leg (§6) is **unproven**.

The Critic and Reviewer may continue to produce artifacts (Path 2 is always available). The Engineer and Architect may continue under baseline items 1, 3, 4, and 7, with the caveat that "peer messaging" means "the message was sent; whether the receiver received and acted on it is unverified until AT-ASYNC-SEND, AT-CORRELATION, and AT-NON-BLOCK-SENDER pass for that pair."

---

## 11. Risks and open questions

### 11.1 Risks v2 does NOT close (could not resolve from analysis alone)

- **R-HIGH.** Whether the runtime allowlist can be configured to expose `intercom` to Critic and Reviewer sessions without violating `acceptanceRole: read-only` is an open question. v2 prescribes the wiring as required (§4.2, §8.2 U2) but does not prove it is possible.
- **R-MEDIUM.** Whether Codex Lead's session can be reached as a peer by Pi subagents via `intercom` is unverified. The Lead's runtime configuration for receiving intercom messages is OUT OF SCOPE for v2; AT-LEAD-MIRROR (§10) is the gate.
- **R-MEDIUM.** The dedup cache lifecycle (§5.4) is a per-recipient role-memory concern. Role-memory persistence across restarts is not characterized for this project; a cache that does not survive restart defeats dedup.
- **R-MEDIUM.** `pi-subagents` and `pi-intercom` are community packages; the closed enum and action surface may evolve. v2 pins against the verified surface (C1, C3, C4 in §8.1); future changes require a new architecture revision.
- **R-LOW.** UX for `contact_supervisor({ reason: "interview_request", interview: {...} })` in this project — whether the supervisor answers structured multi-option interactively or as freeform prose — is not demonstrated.
- **R-LOW.** Conflict-resolution precedence (User > Lead > domain-specialist-on-domain > domain-specialist-off-domain) is principled; the `most-recent-writer` tail has been removed per baseline correction. The chosen rule has not been exercised against a real cross-cutting decision in this project; user choice D-1 (whether the precedence rule itself is accepted) is still pending.
- **R-LOW.** Git-history tamper detection (§7) is a process claim; it depends on a human reviewer actually running the git commands on a regular cadence. No automation enforces it.

### 11.2 Open questions for the next stage

- **Q1.** Confirm or revise the conflict-resolution precedence rule (baseline D-1).
- **Q2.** Confirm the runtime mechanism by which Codex Lead receives `intercom` messages (i.e., is Codex Lead's session an intercom client, or does Codex Lead only read peer artifacts on a phase boundary?).
- **Q3.** Confirm whether `intercom` can be exposed to Critic and Reviewer while keeping `acceptanceRole: read-only`.
- **Q4.** Confirm the dedup-cache persistence model (per-session memory vs. project-scoped memory).
- **Q5.** Confirm the human-review cadence for `.pi/decisions/` git-history audits.

### 11.3 Items that still require explicit user authority

Per baseline correction and per the gate in `.pi/decisions/2026-08-21-agent-team-communication-baseline.md` ("No Agent definition or communication-tool configuration may be changed until Architect produces v2 and Critic reports no blockers against this decision"):

- **I-AUTH-1.** Acceptance of v2 as the superseding architecture. Until Critic reports no blockers against this decision, no runtime wiring change is authorized.
- **I-AUTH-2.** Authorization to configure the runtime allowlist to expose `intercom` to Critic and Reviewer (a runtime configuration change; not an agent-definition edit).
- **I-AUTH-3.** User choice D-1 (the precedence rule for cross-cutting decisions).
- **I-AUTH-4.** Authorization to begin the acceptance matrix run (§10). The matrix must complete before any "peer messaging" is treated as proven.

---

## 12. Cross-reference back to the baseline

The baseline decision `.pi/decisions/2026-08-21-agent-team-communication-baseline.md` is fixed. v2 implements each accepted item as follows:

| Baseline item | v2 section |
|---|---|
| 1. Codex is the sole Lead. | §2, §3.1, §11 (R-MEDIUM) |
| 2. Pi orchestrator is execution/communication bridge without independent authority. | §3.1 (Architect, Engineer, etc. are advisory on Lead's domain) |
| 3. Hub-and-spoke by default. | §3.2, §4.4 |
| 4. Initial peer pairs limited to Researcher ↔ Architect and Architect ↔ Critic. | §4.4, §8.2 U1, U2, AT-DISCOVERY, AT-UNAUTH-PAIR |
| 5. Reviewer communicates through Lead initially. | §4.4 |
| 6. Critic/Reviewer may use `contact_supervisor` only for risk/verdict escalation. | §4.3, §9 (Critic unavailable fallback) |
| 7. Mirror-to-Lead rule with immediate/deferred split. | §3.2, §4.4 |
| 8. One UUID per logical request, reused on retry. | §5 |
| 9. Scope-change via mark-stale, cancel, preserve-partial, restart. No live broadcast assumption. | §6, §8.2 U12, AT-CANCEL |
| 10. Critic unavailable → `unverified-architecture` flag, except for blocked action classes. | §9 |
| Correction: remove `most-recent-writer`. | §3.1 |
| Correction: remove `priority: blocking`, `reply_path: live`. | §1.1, §3.4 |
| Correction: keep `contact_supervisor.reason` within closed enum. | §3.3, §4 (extension protocol) |
| Correction: do not claim allowlist = proven; require empirical test. | §8.2, §10 |
| Correction: replace mtime tamper detection with git history review. | §7 |
| Correction: Lead-to-User is ordinary Codex conversation. | §3.2, §2 |
| Correction: keep application-layer hashes out. | §3.4, §5 |

---

## 13. Document metadata

- version: v2 (initial)
- decider: User (via baseline acceptance of 2026-08-21-01) + Architect (this artifact)
- consulted: Researcher (research brief `.pi/research/agent-team-communication-report.md`), Critic (pending review of v2)
- informed: Engineer, Reviewer, Critic, Researcher
- supersedes: `.pi/research/agent-team-communication-architecture.md` (v1)
- supersedes_reason: Closes Critic blockers A–J; corrects Lead identity to Codex; aligns to baseline 2026-08-21-01.
- open-risks: §11.1 (R-HIGH, R-MEDIUM ×3, R-LOW ×3)

