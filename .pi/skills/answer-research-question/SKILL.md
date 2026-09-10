---
name: answer-research-question
description: Answer one specific, bounded research request using local reads, grep/find/ls, web_search, fetch_content, get_search_content, source_check, and write, while remaining available for later requests in the same Pi Team session. Use when Lead starts a Researcher or a paired Executor sends a scoped follow-up request. Do not use for architecture, implementation, multi-question scoping, or Deep Research MCP workflows.
---

# Answer Research Question

## Overview

Deliver a concise, evidence-backed answer to one bounded request and persist it as a research artifact. Each turn is bounded, but the Researcher session remains event-driven and available for later same-task requests; the session is not a one-shot research program.

## When to use

Use this skill when:
- Lead (Codex) starts the Researcher with one specific question, or the paired Executor sends one scoped follow-up request for the same task.
- The answer must cite sources and land at the project root path `research/<task-id>-<topic-slug>.md` (or the path specified in the request/contract).
- The work fits in local reads plus targeted web lookups.

Do not use this skill when:
- The question is architectural or implementation-shaped → route to Lead.
- The question spans many sub-questions → publish `blocked` with `blackboard_update` and request explicit scoping.
- A Deep Research MCP workflow is requested → that path is intentionally unavailable; escalate.

## Required Tools and their roles

- `read`, `grep`, `find`, `ls` — local inspection only; cite exact paths and versions for pivotal local claims.
- `web_search`, `fetch_content`, `get_search_content`, `source_check` — web discovery and source validation.
- `write` — persist the research artifact only.
- `blackboard_update` — publish material findings, blockers, and scope decisions to Lead; a `blocked` state requests a Lead wakeup.
- `pi_team_intercom` — direct peer channel only with Executor; its registered description is the sole JSON event contract.

## Workflow

1. Read the current Lead task or runtime-projected Executor request. Capture its bounded objective, allowed paths, artifact reference, capabilities, and constraints. Validate scope before web access; for a refusal, use `RESEARCH_BLOCKED` according to the registered `pi_team_intercom` tool description.
2. State the question back in one sentence before searching so scope is explicit.
3. Inspect the local project with `ls`, `find`, `grep`, `read` only for facts the question requires; do not scan the whole workspace.
4. Use `web_search` to discover candidate sources; use `fetch_content` / `get_search_content` to retrieve and `source_check` to validate provenance.
5. If a source cannot be validated, mark the claim as `unsourced` and exclude it from the headline answer.
6. Synthesize the answer with this structure:
   - Question (one sentence).
   - Headline answer (1–3 sentences).
   - Supporting evidence with source URLs or local paths.
   - Unresolved contradictions or gaps.
   - Confidence and any caveats.
7. Write the artifact with `write` to the requested path. Default location is `research/<task-id>-<topic-slug>.md`; the slug is a unique, human-readable kebab-case topic label with no spaces or path separators. Do not overwrite another request's artifact unless explicitly instructed, and do not generate a task ID, UUID, or content hash.
8. Send `RESEARCH_RESULT` to `to: "executor"`; runtime constructs transport. Read the exact JSON fields from `pi_team_intercom`, then publish material findings with `blackboard_update`.
9. If the request cannot safely proceed, send `RESEARCH_BLOCKED` to the paired Executor using the tool contract and report `blocked` to Lead with the reason and next decision needed.
10. After each request, update Blackboard to `waiting` and end the turn idle/event-driven. Do not mark the session `completed` after one request and do not exit or stop waiting. Only explicit Lead completion/reclaim ends the Researcher session. The runtime enforces a Researcher-side Blackboard protocol: `activity` is the observed fact (no placeholder text, no verbatim repeats of the prior event), `blocker` is required whenever the state is `blocked`, `next` is required for every non-terminal state except `completed`, and identical repeats of the prior event are refused.
## Boundaries

- One bounded request per turn; refuse multi-question scoping and escalate to Lead.
- Never invent claims, fabricate citations, or paste content without provenance.
- IDs come from Lead; never use content hashes or self-generated UUIDs for the task.
- Architecture or product decisions are Lead+User territory; mirror findings, do not decide.
- Persist only durable research knowledge (trusted sources, confirmed facts, known gaps). Do not store secrets.
- Keep discovery bounded to the current request. Do not create a Scout, repeat discovery without new evidence, or decompose new questions without Lead direction. Executor follow-up requests are allowed only when they remain within the frozen task contract.
