# Researcher Memory

## Local ecosystem discovery map

- Start local Pi discovery from `.pi/settings.json`, `.pi/agents/researcher.md`, `.pi/npm/node_modules`, and `.pi/researcher-runtime/node_modules`; do not rediscover the entire workspace on every assignment.
- `.pi/npm/node_modules` is the shared project package root. The Researcher runtime contains the MCP client SDK and project adapter; the professional Deep Research implementation is external and must not be reimplemented in the role.
- A `before_agent_start` hook generates the current package/version/source snapshot from live files. Treat that snapshot as changing context, not durable memory. Verify pivotal behavior against the referenced local source.
- Store stable paths, package relationships, effective queries, and recurring pitfalls here. Do not store installed versions, one-run inventories, or copied search results because they become stale.
- For an unfamiliar capability, check in this order: known local anchors → exact installed source/API → upstream repository/docs → broader ecosystem search. Expand beyond that route only when a concrete gap remains.

## Research method

- Research lifecycle: durable orchestration run → Deep Research MCP task → bounded status monitoring → frozen MCP result artifact → evidence/coverage review gate → fresh final-report synthesis. Raw result bodies and transient tool output are not memory and must not be pasted into the main Researcher context.
- Runtime checkpoint counts persisted tool calls and payload usage; model-supplied round/source counts are advisory only. Use rollover when the configured budget is reached and retain the run directory for resume.

- For concepts, frameworks, architecture, and new subsystems, include a provenance section: origin, original problem, canonical name/source, later adaptations, and project-local changes.
- Before recommending custom implementation, identify existing local and open-source candidates and make a proportionate `reuse`, `extend`, or `build` decision using scope fit, extension boundary, maintenance/activity, license, and integration cost.
- A `deep_research_review` verdict measures contract completeness and coverage of the delegated result. It does not independently validate the truth of claims; pivotal claims still require traceable primary-source citations from the MCP result.
- Keep delegated evidence collection distinct from synthesis. The MCP owns search, retrieval rounds, decomposition, and source cross-validation; Researcher owns orchestration, budgets, review, and the final report. Retain contradictions and gaps explicitly.

## Trusted recurring sources

- **pi.dev/packages/{name}** — Tier 1 authoritative Pi ecosystem package docs (intercom, subagents, supervisor). Use for canonical API shapes (`contact_supervisor`, `intercom`, reasons enum).
- **github.com/earendil-works/pi** — Tier 1 monorepo manifest. Lists canonical Pi package list and shows that pi-subagents / pi-intercom are community packages, not core.
- **github.com/tintinweb/pi-subagents** — Tier 1 pi-subagents architecture reference (handle addressing, project-level overrides, fleet view).
- **confluent.io/blog** — Tier 1 vendor but evidence-grounded for event-driven multi-agent patterns (blackboard-as-log, immutable SoT).
- **atlassian.com/software/jira/guides/agentic-engineering** — Tier 1 escalation triggers framework (missing context, low confidence, policy boundary).
- **langchain.com/blog** — Tier 1 `interrupt()` HITL primitive reference (pause/resume/replay pattern).

## Confirmed domain facts

- **Multi-agent coordination patterns** (recurring across sources): hub-spoke (orchestrator-worker), hierarchical, peer-to-peer (mesh), blackboard (shared state), pub-sub, sequential/pipeline. Hub-spoke is the most common in production 2026 (dev.to agentsindex, Augment Code).
- **HITL escalation trigger set** converges on 6 signals across DigitalApplied 2026 and Atlassian Jira: confidence threshold breach, action-risk-tier match, frustration/sentiment signal, SLA-approaching breach, irreversibility flag, anomaly/injection signal.
- **Pi subagent communication model** (canonical): child sessions get `contact_supervisor` ONLY when pi-subagents supplies child bridge metadata; normal sessions see only `intercom`. Reasons enum: `need_decision` (blocking), `interview_request` (structured), `progress_update` (non-blocking). Routine completion returns via pi-subagents, NOT contact_supervisor.
- **Idempotency requirement** for agent messages: at-least-once delivery means every event needs a unique idempotency key for downstream dedup (CockroachLabs). Many production implementations still lack this (Maxim AI) — adoption gap, not a contradiction in the recommendation.
- **Decision authority frameworks** for agent teams: RACI (Responsible/Accountable/Consulted/Informed) is the most cited single-decision-owner pattern (Slack, Atlassian, TeamGantt). Single "A" per task is the rule.
- **Conflict resolution options** observed: event sourcing + CRDT for state convergence (Zylos Research), optimistic concurrency control (Maxim AI), LLM-driven semantic resolution layered on top of structural primitives.

## Evidence gaps

- Empirical benchmarks on heartbeat-vs-event-driven-only feedback cadence for multi-agent systems are sparse; current literature is mostly advisory.
- AI-specific decision-log tools (vs general-purpose audit logs) are emerging but lack stable, long-term references.
- Production data on cross-machine Pi-to-Pi agent coordination (e.g., the YouTube demos) is anecdotal; no formal write-ups.

## Effective search strategies

- Combine `pi-*` ecosystem queries (canonical API) with general multi-agent pattern queries (transferable lessons) for full coverage of Pi-specific Q6 + general Q1-Q5.
- For "lessons from X framework", pair authoritative docs (pi.dev) with high-star GitHub repos (tintinweb, earendil-works) and then a video walkthrough to capture operator-level lessons.
- For HITL cadence/sync-vs-async, augment pattern docs with operations-blogger sources (Slack, LangChain blog) — the framework docs cover primitives, not operational cadence.
- For ownership/confusion, search "RACI" or "DACI" or "RAPID" — those are the canonical decision-authority frameworks even for AI agent teams.

## Known contradictions (resolved)

- **Mesh vs hub-spoke debugability**: Augment Code (accountability cost framing) vs dev.to agentsindex (debug pain framing). Both agree resilience is up; the disagreement is operational weight only.
- **Idempotency adoption**: CockroachLabs (prescriptive) vs Maxim AI (descriptive gap). Same recommendation, different framing.
