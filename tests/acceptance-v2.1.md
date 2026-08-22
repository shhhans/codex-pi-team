# Architecture v2.1 acceptance record

This is a project evidence index for the 13 gates in §10 of the approved architecture. The entries point to executable tests; they are intentionally not a replacement for the gate definitions. `AT-TAMPER` uses the scoped `Pi-team` Git repository and synthetic fixture; it does not claim that untracked approved documents have historical coverage. No approved architecture or decision file was modified.

| Gate | Status | Evidence |
|---|---|---|
| AT-ALLOWLIST-EXP | DEFER (provider) | Role/config smoke passes; real MiniMax-M3 test is wired in `tests/agent-communication.test.mjs`, but the latest provider attempt returned no session output (manual earlier run had an allowed Researcher tool call) |
| AT-DISCOVERY | PASS | `tests/intercom-child.mjs` list-cwd/session discovery; `resolvePeerRole` accepts a returned session id only after safe role resolution |
| AT-ASYNC-SEND | PASS | `tests/intercom-child.mjs` delivery wall-clock assertion |
| AT-CORRELATION | PASS | `tests/intercom-child.mjs` reply correlation id assertion |
| AT-NON-BLOCK-SENDER | PASS | `tests/intercom-child.mjs` independent read completes before delayed reply |
| AT-LEAD-MIRROR | PASS | `tests/lead-routing-child.mjs` Architect/Researcher progress mirrors reach Lead |
| AT-SUPERVISOR-ESC | PASS | `tests/lead-routing-child.mjs` supervisor route is received by Lead |
| AT-CRITIC-ESC | PASS | `tests/lead-routing-child.mjs` Critic `need_decision` reaches Lead; other reasons are refused |
| AT-REVIEWER-ESC | PASS | `tests/lead-routing-child.mjs` Reviewer `need_decision` reaches Lead |
| AT-CANCEL | PASS | `tests/lifecycle-child.mjs` marks stale, preserves partial, reaches safe boundary, starts new plan; no intercom cancel is used |
| AT-DEDUP | PASS | `tests/persistent-replay-child.mjs` survives process restart and replays original reply for same logical UUID |
| AT-UNAUTH-PAIR | PASS | runtime negative-control trace refuses before transport; no `send`/`ask` call is recorded |
| AT-TAMPER | PASS | Baseline commit `a7e0b2c` for `.pi/decisions/_at-tamper-fixture.md`; out-of-band edit is visible in `git diff` and the baseline is visible in `git log -p` |

The aggregate runner is `tests/run-tests.ps1`; the record must be regenerated/reviewed after any rollout change. The Git repository is scoped to `Pi-team`; the synthetic fixture remains intentionally modified in the working tree so the tamper evidence is inspectable.
