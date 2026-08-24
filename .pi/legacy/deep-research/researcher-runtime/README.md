# Researcher / Deep Research MCP boundary

The Researcher is an orchestration, context-management, review, and final-report layer. It does not search the web, fetch pages, decompose research questions, run retrieval rounds, or cross-validate sources. Those capabilities are supplied by a professional Deep Research MCP server.

## Configuration

- Local default: stdio gptr-mcp sidecar at `.sidecar/gptr-mcp`; set `DEEP_RESEARCH_MCP_URL` only when an existing runtime requires Streamable HTTP.
- `DEEP_RESEARCH_MCP_DISABLE_STDIO=1` explicitly disables the MCP research capability; there is no direct-web-search fallback.
- `GPTR_MCP_PYTHON` (optional): absolute sidecar Python path override.
- `MINIMAX_API_KEY` (required for stdio): mapped in-process to `OPENAI_API_KEY`.
- `MINIMAX_OPENAI_BASE_URL` (optional): MiniMax OpenAI-compatible endpoint; defaults to `https://api.minimaxi.com/v1` for the current Researcher key.
- The sidecar sets `EMBEDDING=minimax:embo-01` and adapts MiniMax's native embedding response; this is not a fallback search engine or a second paid provider.
- `DEEP_RESEARCH_MCP_TOKEN` (optional): bearer token.
- `DEEP_RESEARCH_MCP_TIMEOUT_MS` (optional, default `120000`).
- `DEEP_RESEARCH_MCP_START_TOOL`, `DEEP_RESEARCH_MCP_STATUS_TOOL`, `DEEP_RESEARCH_MCP_RESULT_TOOL`, `DEEP_RESEARCH_MCP_CANCEL_TOOL`: optional tool-name overrides.

The stdio gptr-mcp protocol discovers `deep_research`, `get_research_context`, and `get_research_sources`. The adapter maps its synchronous research ID to the Researcher task lifecycle and never calls `write_report`. The legacy task protocol remains available for Streamable HTTP servers. Result must return a JSON object with:

```json
{
  "report": "cited research result",
  "findings": [],
  "sources": [{ "source_id": "source-1", "url": "https://..." }],
  "citations": [{ "source_id": "source-1", "claim": "..." }],
  "contradictions": [],
  "gaps": [],
  "coverage": [{ "sub_question": "exact requested question", "status": "covered" }]
}
```

The adapter discovers tools before the first call and fails closed when required operations are absent. Raw MCP results are persisted under `.pi/research/runs/<run-id>/deep-research/`; only bounded, reviewed synthesis input enters the Researcher context. Final report creation is blocked until the result passes provenance and coverage review.
