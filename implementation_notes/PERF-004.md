# PERF-004 — Executor Implementation Notes

- Lead task ID: **PERF-004**
- Delegation ID: **EXECUTOR-004**
- Worktree: `D:/Coding/Harness/Pi-team-PERF-004`
- Branch: `pi-team/PERF-004` (base ref `integrate/pi-team-flow-lifecycle`)
- Slice state: READY_FOR_REVIEW
- Date: 2026-08-27 (capture-time only)

## Scope delivered

Per Lead assignment C-002 / C-004 and the EXECUTOR-004 delegation, this slice delivers:

1. A **read-only runtime baseline** captured against the three roles (executor, reviewer, researcher) that were launched by `pi-team.cmd start` for PERF-004 on the integrated entrypoint — no production code, configuration, test, or spec edits were made.
2. An environment limitation note where the baseline cannot be made perfectly reproducible (cross-process environment inspection requires elevated permissions).
3. A candidate optimization list **ranked by benefit / risk / implementation cost** with measurement method, expected impact, and validation standard for each option.
4. A reproducible experiment matrix that names path, command, observation, and the inference or to-be-measured dimension.

Files produced inside the worktree (worktree-relative paths, all new):

- `implementation_notes/PERF-004.md` (this file)
- `reports/PERF-004-performance-options.md` (main deliverable)

No code, configuration, test, or spec document under the integrated branch was edited; the only file system change is the two new artifact files above plus the directory `reports/`. `git status` confirms the only untracked entry under the worktree is `research/PERF-004-static-survey.md` (Researcher's slice, untouched by Executor).

## Files "changed"

In the contract sense, this task produces new artifacts, not modifications to production code. Diff against `integrate/pi-team-flow-lifecycle..HEAD` is empty (clean). The slice adds:

```
?? implementation_notes/PERF-004.md
?? reports/PERF-004-performance-options.md
?? reports/                              (new directory)
?? research/PERF-004-static-survey.md    (Researcher; Executor did not touch)
```

## Validation performed

All diagnostics were executed inside the worktree using only safe, read-only Windows-side commands (`Get-Process`, `Get-CimInstance Win32_Process`, `Get-NetTCPConnection`, `git diff/log/status`, `pi-team.cmd doctor`, and `node` against the read-only `blackboard-cli.mjs`). None of these modifies production state. The exact reproducible commands are listed under "Experiment matrix" in `reports/PERF-004-performance-options.md`.

- **Process liveness**: `Get-Process -Id 332`, `-Id 23260`, `-Id 27348` all returned `node.exe` (the Pi agent host for each role); the runtime PIDs in the state JSON (`pi-team/v1/PERF-004-{role}-runtime.json`) match the live PIDs.
- **Process tree**: confirmed by `Get-CimInstance Win32_Process` that each role's chain is `WindowsTerminal (PID 26748) → OpenConsole → powershell.exe (EncodedCommand decoder) → cmd.exe → node.exe`. Windows Terminal itself is one process for all three roles, not three.
- **CPU / RSS**: sampled twice across ~3 s; measurements are recorded in `reports/PERF-004-performance-options.md` § "Live baseline captured" with explicit observation / inference labels.
- **Network**: `Get-NetTCPConnection` shows 2 of 3 roles hold an established TLS connection to `198.18.0.235:443` (reviewer has none). This implies 2 outbound calls per session — relevant to the cost of the optional `pi-web-access` extension in researcher + executor (executor runs intercom + blackboard-update extensions, but the TLS connection matches `pi-web-access`-shaped traffic and is open even for the executor who does not have the `pi-web-access` extension; left as a 待测 indicator).
- **Snapshot cost**: `node plugins/agent-blackboard/server/blackboard-cli.mjs "" <projectRoot>` was timed across 3 hot runs (34–41 ms) and one cold run (54 ms). Cost grows linearly with the number of `.jsonl` files in `<commonDir>/harness-blackboard/v1/`.
- **Doctor cost**: `pi-team.cmd doctor` ran in ~1080 ms and scanned 15 tasks across `pi-team/v1/*.json`.
- **Audit directory**: `.pi/communication/audit/researcher.jsonl` and `reviewer.jsonl` exist in the worktree but their last entries are 2025-08-25, indicating the runtime audit is not actively appending for this session — `HARNESS_POLICY_AUDIT_DIR` is unset in the runtime env (observed default). `HARNESS_REPLY_STORE_DIR` and `HARNESS_LIFECYCLE_ROOT` are likewise unset; their default directories (`<here>/reply-store` and `<here>/lifecycle`) are not present on disk. This is recorded as a baseline fact, not a defect.
- **Legacy role event journal**: `pi-team/v1/PERF-004-{executor,reviewer}.jsonl` are **absent** on disk; `pi-team/v1/PERF-004-researcher.jsonl` exists with one `completed` entry at 2026-08-27T03:48:10.576Z. The Blackboard (`harness-blackboard/v1/PERF-004-{role}.jsonl`) is the active journal for all three roles. This indicates a divergence between the PowerShell `Event` function (called only from `Start-Task` for executor + reviewer) and the Blackboard MCP path. Recorded as a finding, not a fix.

## Validation results (pass / fail summary)

| Check | Result | Evidence |
| --- | --- | --- |
| Worktree is a clean read of `integrate/pi-team-flow-lifecycle` | PASS | `git diff --stat` empty; `git status` shows only `?? research/PERF-004-static-survey.md` (Researcher artifact) |
| Roles still live and match state JSON | PASS | All three PIDs alive; runtime JSONs match |
| No production / config / test / spec edits | PASS | No edit/write outside the two new artifacts and the new `reports/` directory |
| No commit / stash / reset / checkout / cleanup | PASS | `git status` clean against base |
| No concurrent role launch | PASS | No `pi-team.cmd start` / `research` / `resume` invoked from this session |
| Doctor scans existing tasks cleanly | PASS | All PERF-004 roles reported `health=active execution=active outcome=pending` |

## Remaining risks / open items

- The runtime `HARNESS_POLICY_AUDIT_DIR` is unset; verifying how the policy audit is actually persisted (or whether it is silently dropped) requires inspecting the Node child process environment, which is out of scope without elevated tooling. Marked 待测 in the report.
- The exact byte/cycle cost of Mechanism 5 (Gzip + Base64 + UTF-16LE round-trip) requires a profiled `start <task>` re-run; this would re-launch the very pair that this report must keep alive, so it is left as an experiment-matrix entry rather than measured now.
- The legacy role-event journal divergence (PowerShell `Event` vs Blackboard `appendAgentEvent`) was observed but not exercised; follow-up delegation may need to confirm whether the PowerShell path is intentionally deprecated.
- All `expected impact` numbers in the ranked options are order-of-magnitude estimates derived from the live RSS / thread counts and the source code; the report explicitly labels each as 推断 and pairs each with a reproducible measurement.

## Handoff

- Paired Reviewer target (via `intercom list-cwd`): `pi-team--PERF-004--reviewer--<launch-id>` (the `reviewer` row of `intercom list-cwd` in this worktree).
- Paired Researcher target: `pi-team--PERF-004--researcher--<launch-id>` (already received a single `progress` envelope from Researcher containing "Six mechanisms identified in the integrated Pi Team bootstrap").
- Reviewer entry-point artifacts:
  - Worktree: `D:/Coding/Harness/Pi-team-PERF-004`
  - Notes: `implementation_notes/PERF-004.md`
  - Main deliverable: `reports/PERF-004-performance-options.md`
  - Researcher's static survey: `research/PERF-004-static-survey.md`

---

## Reviewer clarifications (post-READY_FOR_REVIEW)

Reviewer returned `REVIEW_PASS` (verdict artifact: `reports/PERF-004-review.md`, 15 361 bytes) with three minor clarifications, no failure artifact, no constraint violation, no scope change. The Executor incorporated them as factual corrections in `reports/PERF-004-performance-options.md` § 9:

1. **E-02 snapshot cost** — the CLI invocation does not invoke `snapshot()`; numbers are a module-load + error-throw proxy. Reviewer direct `snapshot()` call returned 42.62 / 31.99 / 26.65 ms — same order of magnitude. Both sets of numbers retained with caveat.
2. **E-16 process count** — corrected from 13 to 18 by adding 1 extension-spawned powershell (child of reviewer node 23260) + 4 support node processes (2 blackboard-mcp servers PIDs 3140 / 19300, 2 intercom broker PIDs 21768 / 27280).
3. **Option 2 framing** — reframed from "pure code deletion" to "stop calling PowerShell `Event` from non-terminal-state code paths and route all event writes through Blackboard MCP". Reviewer observation at 2026-08-27T04:18:40Z (the executor's `READY_FOR_REVIEW` envelope triggered the legacy journal to be written) confirms the legacy path is alive.

Reviewer also independently re-measured: E-01 doctor 1 176 / 1 273 ms (Executor 1 080 ms, within +9 % / +18 % variance); E-03 RSS 276.6 / 157.7 / 130.7 MB (Executor 234.5 / 137.3 / 129.8 MB; growth attributable to natural tool work); E-07 I/O 5 632 / 4 262 / 4 442 reads (grew naturally); E-08 3 blackboard files confirmed.

End of Executor notes.

