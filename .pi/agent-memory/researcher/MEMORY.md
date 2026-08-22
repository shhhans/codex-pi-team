# Researcher Memory

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