# Architecture v2.1 acceptance record

This is a project evidence index for the 13 gates in §10 of the approved architecture. The entries point to executable tests; they are intentionally not a replacement for the gate definitions. The full runtime command is `$env:HARNESS_RUN_REAL_ESCALATION=1; powershell -File tests/run-tests.ps1` and completed 12/12. `AT-TAMPER` uses the scoped `Pi-team` Git repository and synthetic fixture; approved documents are now tracked in the baseline commit and were not modified by the test.

| Gate | Status | Evidence |
|---|---|---|
| AT-ALLOWLIST-EXP | PASS | `tests/agent-communication.test.mjs` real MiniMax-M3 Researcher Role Session loads `pi-intercom` plus the Researcher policy extension and records an allowed tool call |
| AT-DISCOVERY | PASS | `tests/intercom-child.mjs` list-cwd/session discovery; `resolvePeerRole` accepts a returned session id only after safe role resolution |
| AT-ASYNC-SEND | PASS | `tests/intercom-child.mjs` delivery wall-clock assertion |
| AT-CORRELATION | PASS | `tests/intercom-child.mjs` reply correlation id assertion |
| AT-NON-BLOCK-SENDER | PASS | `tests/intercom-child.mjs` independent read completes before delayed reply |
| AT-LEAD-MIRROR | PASS | `HARNESS_RUN_REAL_ESCALATION=1` real MiniMax Role Session test routes Architect/Researcher `contact_supervisor(progress_update)` messages to the Lead session; `tests/lead-routing-child.mjs` remains the deterministic policy/transport negative control |
| AT-SUPERVISOR-ESC | PASS | `HARNESS_RUN_REAL_ESCALATION=1` real MiniMax Role Session test receives Lead-route messages and replies to blocking requests |
| AT-CRITIC-ESC | PASS | Real MiniMax Critic Session uses `contact_supervisor(reason: need_decision)` and reaches Lead; policy rejects other reasons |
| AT-REVIEWER-ESC | PASS | Real MiniMax Reviewer Session uses `contact_supervisor(reason: need_decision)` and reaches Lead |
| AT-CANCEL | PASS | `tests/lifecycle-child.mjs` marks stale, preserves partial, reaches safe boundary, starts new plan; no intercom cancel is used |
| AT-DEDUP | PASS | Persistent component test plus `real context hook reserves UUIDs and replays the original reply after policy restart` prove the Pi context hook reserves, persists, and replays |
| AT-UNAUTH-PAIR | PASS | runtime negative-control trace refuses before transport; no `send`/`ask` call is recorded |
| AT-TAMPER | PASS | Baseline commit `a7e0b2c` for `.pi/decisions/_at-tamper-fixture.md`; out-of-band edit is visible in `git diff` and the baseline is visible in `git log -p` |

The aggregate runner is `tests/run-tests.ps1`; the record must be regenerated/reviewed after any rollout change. The Git repository is scoped to `Pi-team`; the synthetic fixture remains intentionally modified in the working tree so the tamper evidence is inspectable.
