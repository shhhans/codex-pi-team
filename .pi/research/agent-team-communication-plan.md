# Approved Research Contract: Agent Team Communication Architecture

Status: approved by user
Depth: deep

## Objective

Research collaboration and communication architecture for a Pi-based Agent Team. Prioritize general architecture evidence, then relevant Pi open-source implementations.

The report must answer:

1. When should the team give feedback to the user, including escalation triggers, cadence, channel, and format?
2. Should peer agents communicate directly, and under which conditions should communication instead pass through the Lead?
3. How should the system prevent lost, duplicated, stale, contradictory, or authority-confusing information and decisions?

## Approved sub-questions

1. What events require human feedback or approval in multi-agent systems?
2. Which feedback formats and synchronous/asynchronous channels work best for human-in-the-loop workflows?
3. What are the tradeoffs between peer-to-peer and Lead-mediated hub-and-spoke communication?
4. If peer communication is permitted, which message-passing, queue, event, shared-state, or publish/subscribe patterns fit which situations?
5. Which single-source-of-truth, decision-log, ownership, schema, versioning, and conflict-resolution mechanisms prevent information and decision confusion?
6. What concrete lessons follow from current Pi open-source implementations, particularly pi-subagents, contact_supervisor, and pi-intercom?

## Research budget

- Maximum 10 searches and 15 retained sources.
- Four planned rounds: human feedback; agent communication; anti-confusion plus Pi implementations; gap filling and contradiction resolution.
- Call research_checkpoint after every round and obey CONTINUE/PROCEED.
- Target confidence: 85%.
- Deep-read Tier 1 and Tier 2 sources with web_extract.

## Required output

Write a deep-level Markdown research report in the project working directory. Include evidence-linked conclusions, comparison with narrative analysis, contradictions, uncertainties, methodology, and sources. Do not implement the architecture.
