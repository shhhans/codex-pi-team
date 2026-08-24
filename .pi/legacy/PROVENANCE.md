# Legacy Material Provenance Manifest

This manifest records the path-to-path provenance of every file moved into
`.pi/legacy/` and the copy from `.sidecar/gptr-mcp/` during the
minimal-team cutover (Lead task `BOOTSTRAP-SELF-002`). No content hashes are
used; identity is established by path, file name, package version (when
present), and source-of-truth git location.

## Source scope

Canonical repository: `D:\Coding\Harness\Pi-team` (tracked branch worktree,
git history is the source of truth). The canonical repository was **not**
modified by this cutover; only files inside the assigned worktree
`D:\Coding\Harness\Pi-team-bootstrap` were added or moved.

Copy policy: source/tests/docs/config only. Excluded categories:
`.git`, `node_modules`, `venv/.venv`, `__pycache__`, caches, traces,
audit logs, reply-store JSON, `.env`, secrets.

## Roles moved into `.pi/legacy/`

| Destination path | Source path | Notes |
| --- | --- | --- |
| `.pi/legacy/agents/architect.md` | `.pi/agents/architect.md` | Unchanged |
| `.pi/legacy/agents/critic.md` | `.pi/agents/critic.md` | Unchanged |
| `.pi/legacy/agents/engineer.md` | `.pi/agents/engineer.md` | Unchanged |
| `.pi/legacy/communication/extensions/architect.ts` | `.pi/communication/extensions/architect.ts` | Unchanged |
| `.pi/legacy/communication/extensions/critic.ts` | `.pi/communication/extensions/critic.ts` | Unchanged |
| `.pi/legacy/communication/extensions/engineer.ts` | `.pi/communication/extensions/engineer.ts` | Unchanged |
| `.pi/legacy/communication/audit/architect.jsonl` | `.pi/communication/audit/architect.jsonl` | Role-specific audit, not part of shared intercom |
| `.pi/legacy/communication/audit/critic.jsonl` | `.pi/communication/audit/critic.jsonl` | Role-specific audit, not part of shared intercom |
| `.pi/legacy/communication/reply-store/architect/` | `.pi/communication/reply-store/architect/` | Role-specific replay store |
| `.pi/legacy/communication/reply-store/engineer/` | `.pi/communication/reply-store/engineer/` | Role-specific replay store |
| `.pi/legacy/agent-memory/architect/MEMORY.md` | `.pi/agent-memory/architect/MEMORY.md` | Unchanged |
| `.pi/legacy/agent-memory/critic/MEMORY.md` | `.pi/agent-memory/critic/MEMORY.md` | Unchanged |
| `.pi/legacy/agent-memory/engineer/MEMORY.md` | `.pi/agent-memory/engineer/MEMORY.md` | Unchanged |

## Retired Researcher bootstrap extension

| Destination path | Source path | Notes |
| --- | --- | --- |
| `.pi/legacy/communication/researcher-local-discovery.mjs` | `.pi/communication/researcher-local-discovery.mjs` | Preserved unchanged; not loaded by the bounded Researcher |

## Deep Research material moved into `.pi/legacy/deep-research/`

All paths below are inside the canonical repository
`D:\Coding\Harness\Pi-team`; each entry lists the exact filename copied and
the package version (where `package.json` was present) as ground truth.

| Destination path | Source path | Source version / size |
| --- | --- | --- |
| `.pi/legacy/deep-research/researcher-runtime/README.md` | `.pi/researcher-runtime/README.md` | n/a |
| `.pi/legacy/deep-research/researcher-runtime/context-management-extension.ts` | `.pi/researcher-runtime/context-management-extension.ts` | n/a |
| `.pi/legacy/deep-research/researcher-runtime/package.json` | `.pi/researcher-runtime/package.json` (canonical) | `@modelcontextprotocol/sdk` 1.30.0; `playwright` ^1.62.1 (devDep) |
| `.pi/legacy/deep-research/researcher-runtime/package-lock.json` | `.pi/researcher-runtime/package-lock.json` | matches `package.json` |
| `.pi/legacy/deep-research/researcher-runtime/.gitignore` | `.pi/researcher-runtime/.gitignore` | n/a |
| `.pi/legacy/research/*.md` (5 architecture docs + 1 plan + 1 report + 2 deep-research notes + 1 provenance) | `.pi/research/*.md` | n/a |
| `.pi/legacy/research/*.mjs` (context-manager, deep-research-mcp-adapter) | `.pi/research/*.mjs` | n/a |
| `.pi/legacy/research/*.json` (acceptance-trace, smoke-trace) | `.pi/research/*.json` | n/a |

Excluded: `.pi/research/runs/` (runtime scratch, gitignored).

## Sidecar copied into `.pi/legacy/deep-research/gptr-mcp/`

Source: `.sidecar/gptr-mcp/` in canonical. Excluded: `.git/`, `.venv/`,
`__pycache__/`.

| Destination file | Source file |
| --- | --- |
| `.env.example`, `.gitignore`, `__init__.py`, `Dockerfile`, `INSTALL.md`, `LICENSE`, `README.md`, `docker-compose.yml`, `minimax_embeddings.py`, `requirements.lock.txt`, `requirements.txt`, `run.sh`, `server.py`, `utils.py` | same filenames in canonical |
| `tests/test_mcp_server.py` | same filename in canonical |

## Canonical tests preserved under `tests/legacy/`

The canonical `.tests/` directory contains six artefacts that this worktree
did not previously track. They are preserved under `tests/legacy/` for
historical reference; `tests/run-tests.ps1` does **not** execute them.

| Destination path | Source path |
| --- | --- |
| `tests/legacy/context-management.test.mjs` | `tests/context-management.test.mjs` |
| `tests/legacy/deep-research-mcp-adapter.test.mjs` | `tests/deep-research-mcp-adapter.test.mjs` |
| `tests/legacy/gptr-mcp-negative-control.mjs` | `tests/gptr-mcp-negative-control.mjs` |
| `tests/legacy/run-deep-research-acceptance.mjs` | `tests/run-deep-research-acceptance.mjs` |
| `tests/legacy/synthesize-frozen-acceptance.mjs` | `tests/synthesize-frozen-acceptance.mjs` |
| `tests/legacy/synthesize-frozen-sections.mjs` | `tests/synthesize-frozen-sections.mjs` |

## Worktree pre-existing tests moved into `tests/legacy/`

The worktree `tests/` directory pre-existed with old v2.1 architecture tests.
They are preserved under `tests/legacy/` for historical reference; the new
`tests/run-tests.ps1` does not run them.

| Destination path | Origin path (worktree) |
| --- | --- |
| `tests/legacy/acceptance-v2.1.md` | `tests/acceptance-v2.1.md` |
| `tests/legacy/agent-communication.test.mjs` | `tests/agent-communication.test.mjs` |
| `tests/legacy/intercom-child.mjs` | `tests/intercom-child.mjs` |
| `tests/legacy/lead-routing-child.mjs` | `tests/lead-routing-child.mjs` |
| `tests/legacy/lifecycle-child.mjs` | `tests/lifecycle-child.mjs` |
| `tests/legacy/persistent-replay-child.mjs` | `tests/persistent-replay-child.mjs` |
| `tests/legacy/real-role-escalation-child.mjs` | `tests/real-role-escalation-child.mjs` |
| `tests/legacy/seed-contract.test.mjs` | `tests/seed-contract.test.mjs` |

## Installed package version (active Researcher provider)

The active Researcher is wired to `pi-web-access` 0.24.2
(`.pi/npm/node_modules/pi-web-access/index.ts`, package name
`pi-web-access`, declared in `.pi/settings.json`). That version is the
current local provider; the Researcher surfaces
`web_search`, `fetch_content`, `get_search_content`, and
`source_check` from it. The Deep Research MCP runtime under
`.pi/researcher-runtime/` (now under `.pi/legacy/deep-research/`)
declares `@modelcontextprotocol/sdk` 1.30.0 in its
`package.json`.

## Out of scope (untouched)

- Canonical repository `D:\Coding\Harness\Pi-team` was not modified.
- The shared intercom implementation under `.pi/communication/` (`policy.mjs`,
  `lifecycle.mjs`, `persistent-store.mjs`, `runtime-policy.mjs`, `send.mjs`,
  `pi-policy-extension.ts`, `canonical-plan.json`, `README.md`, and the
  active `.pi/communication/extensions/{researcher,reviewer}.ts`) remains in
  the worktree unchanged.
- `.pi/agents/{researcher,executor,reviewer}.md` remain in `.pi/agents/`.
- `.pi/decisions/`, `.pi/settings.json`, and `.pi/npm/` remain in place.
