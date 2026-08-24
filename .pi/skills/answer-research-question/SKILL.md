---
name: answer-research-question
description: Answer one specific, bounded research question using local reads, grep/find/ls, web_search, fetch_content, get_search_content, source_check, and write. Use when the Lead delegates a single research question that needs cited findings stored as a research artifact. Do not use for architecture, implementation, multi-question scoping, or Deep Research MCP workflows.
---

# Answer Research Question

## Overview

Deliver a concise, evidence-backed answer to one delegated research question and persist it as a research artifact. Scope is a single question, not a research program.

## When to use

Use this skill when:
- Lead (Codex) delegates one specific research question with a Lead-assigned task ID.
- The answer must cite sources and land at the project root path `research/<task-id>-<slug>.md` (or the path Lead specifies).
- The work fits in local reads plus targeted web lookups.

Do not use this skill when:
- The question is architectural or implementation-shaped → route to Lead.
- The question spans many sub-questions → request scoping via `contact_supervisor` with `reason: "need_decision"`.
- A Deep Research MCP workflow is requested → that path is intentionally unavailable; escalate.

## Required Tools and their roles

- `read`, `grep`, `find`, `ls` — local inspection only; cite exact paths and versions for pivotal local claims.
- `web_search`, `fetch_content`, `get_search_content`, `source_check` — web discovery and source validation.
- `write` — persist the research artifact only.
- `contact_supervisor` — mirror material findings and request scoping decisions; never send to peers via `intercom` except Executor.
- `intercom` — direct peer channel only with Executor (paired executor for the same task); refuse all other peers before `intercom send` or `ask`.

## Workflow

1. Read the Lead task, capture the Lead-assigned task ID, the single question, the artifact path, and any constraints (depth, sources, deadline).
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
7. Write the artifact with `write` to the Lead-specified path. Default location is the project-root path `research/<task-id>-<slug>.md`; the `<slug>` is a short kebab-case topic label (no spaces, no path separators). Include the Lead task ID and do not generate a separate ID.
8. Send the artifact reference to the paired Executor via `intercom` (envelope, not raw body) and mirror material findings to Lead via `contact_supervisor` with `reason: "progress_update"`.
9. Stop. Do not propose architecture, write code, or commit.

## Boundaries

- Single question only; refuse multi-question scoping and escalate to Lead.
- Never invent claims, fabricate citations, or paste content without provenance.
- IDs come from Lead; never use content hashes or self-generated UUIDs for the task.
- Architecture or product decisions are Lead+User territory; mirror findings, do not decide.
- Persist only durable research knowledge (trusted sources, confirmed facts, known gaps). Do not store secrets.
