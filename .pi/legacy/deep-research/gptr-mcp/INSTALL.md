# gptr-mcp sidecar installation

- Source: `https://github.com/assafelovic/gptr-mcp`
- Commit: `63884773685b1f12c7f0d9e283b3d71a5b9b5fda`
- Install location: `.sidecar/gptr-mcp`
- Python: 3.12.13, isolated environment: `.sidecar/gptr-mcp/.venv`
- Transport: local stdio
- Startup: `.sidecar/gptr-mcp/.venv/Scripts/python.exe .sidecar/gptr-mcp/server.py`
- Dependency lock: `requirements.lock.txt`
- `gpt-researcher==0.12.19` is intentional. Versions `>=0.13.5` require LangGraph; this sidecar must not introduce LangGraph. The compatible LangChain stack is pinned to `0.3.x`.
- `langgraph` is absent from the installed environment (`importlib.util.find_spec("langgraph") is None`).
- Embeddings: `EMBEDDING=minimax:embo-01`. The sidecar includes a small adapter for MiniMax's native `texts`/`type`/`vectors` protocol (`type=db` for documents and `type=query` for queries), because the OpenAI embedding response schema is not returned. It uses the same `MINIMAX_API_KEY`; no additional service or key is introduced.

The parent Researcher process supplies `OPENAI_API_KEY` from `MINIMAX_API_KEY`, uses `MINIMAX_OPENAI_BASE_URL` or defaults to the endpoint used by the current Researcher key (`https://api.minimaxi.com/v1`), sets all three GPT Researcher model variables to `openai:MiniMax-M3`, and preserves `TAVILY_API_KEY` for the Tavily retriever. No key is stored in this file, the repository, trace files, or fixtures.

The stdio integration exposes the gptr-mcp tools `deep_research`, `get_research_context`, and `get_research_sources` through the Researcher adapter. `write_report` is intentionally never called. If `DEEP_RESEARCH_MCP_DISABLE_STDIO=1` is set, the Researcher fails closed and does not fall back to web search.
