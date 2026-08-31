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
- The question spans many sub-questions → report `blocked` to Lead with `report_to_lead` and request explicit scoping.
- A Deep Research MCP workflow is requested → that path is intentionally unavailable; escalate.

## Required Tools and their roles

- `read`, `grep`, `find`, `ls` — local inspection only; cite exact paths and versions for pivotal local claims.
- `web_search`, `fetch_content`, `get_search_content`, `source_check` — web discovery and source validation.
- `write` — persist the research artifact only.
- `report_to_lead` — mirror material findings, blockers, and scope decisions to Lead.
- `intercom` — direct peer channel only with Executor (paired executor for the same task); refuse all other peers before `intercom send` or `ask`.

## Workflow

1. Read the current Lead task or Executor request. For an Executor-originated `RESEARCH_REQUEST` body, capture the Lead-assigned task ID (`task_id` must equal `PI_TEAM_TASK_ID`), `delegation_id` (must equal the contract's Researcher delegation), one bounded question/objective, `allowed_paths`, the `artifact_path`, the `decision_supported` it unblocks, `required_capabilities` (must be a subset of `RESEARCHER_CAPABILITIES`), `frozen_contract_version`, optional `deadline_hint` and `context_refs`, and all constraints. Run the schema pre-flight against `policy.mjs` `validateResearchBody` and `authorizeResearchDelegation` before any web-access tool call; a request that fails any check must be `RESEARCH_BLOCKED` with the matching `reason_code` and (when the reason is `architectural | out_of_scope | under_specified`) the required `next_decision_needed`.
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
8. Send a `RESEARCH_RESULT` reference and concise finding to the paired Executor via `intercom` (valid envelope, not a hand-built raw body). The body schema is:

   - `type` (literal `"RESEARCH_RESULT"`),
   - `task_id`, `delegation_id`, `request_id` (mirror the original request; `request_id` must equal the request's `request_id` and the envelope `correlation_id`),
   - `artifact_path` (must equal the request's `artifact_path`; the file must exist and be non-empty on disk at send time),
   - `headline` (one-sentence answer, ≤240 chars),
   - `findings` (non-empty array; each entry has `claim`, `sources[]`, and `confidence` ∈ `high|medium|low`),
   - optional `gaps` (string[]),
   - `confidence` (overall ∈ `high|medium|low`),
   - `decision_impact` (one-sentence description of how the Executor should use the result).

   Report the same material finding, artifact path, confidence, and gaps to Lead with `report_to_lead`.
9. If the request is outside the frozen contract, requires an architecture/product decision, lacks required capability, collides with an in-flight request, hits a stranded-or-finalized artifact, encounters a scope-change invalidation, exceeds the deadline, or cannot be answered safely, send `RESEARCH_BLOCKED` to the paired Executor and report `blocked` to Lead with the reason and next decision needed. The `RESEARCH_BLOCKED` body schema is:

   - `type` (literal `"RESEARCH_BLOCKED"`),
   - `task_id`, `delegation_id`, `request_id` (mirror the original request),
   - `reason_code` ∈ `out_of_scope | architectural | under_specified | capability_blocked | in_flight_busy | scope_change_invalidated | deadline_unmet | duplicate | no_response_within_window`,
   - `detail` (non-empty string, ≤1024 chars),
   - `next_decision_needed` (required when `reason_code` is `architectural | out_of_scope | under_specified`; ≤240 chars; describes the Lead decision that would unblock the Executor).
10. After each request, update Blackboard to `waiting` and end the turn idle/event-driven. Do not mark the session `completed` after one request and do not exit or stop waiting. Only explicit Lead completion/reclaim ends the Researcher session.
## Boundaries

- One bounded request per turn; refuse multi-question scoping and escalate to Lead.
- Never invent claims, fabricate citations, or paste content without provenance.
- IDs come from Lead; never use content hashes or self-generated UUIDs for the task.
- Architecture or product decisions are Lead+User territory; mirror findings, do not decide.
- Persist only durable research knowledge (trusted sources, confirmed facts, known gaps). Do not store secrets.
- Keep discovery bounded to the current request. Do not create a Scout, repeat discovery without new evidence, or decompose new questions without Lead direction. Executor follow-up requests are allowed only when they remain within the frozen task contract.
