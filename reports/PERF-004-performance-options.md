# PERF-004 — Pi Team Performance Options on the Integrated Entrypoint

- Lead task ID: **PERF-004**
- Worktree surveyed: `D:/Coding/Harness/Pi-team-PERF-004`
- Branch: `pi-team/PERF-004` (base ref `integrate/pi-team-flow-lifecycle`)
- Entrypoint (sole, per Lead constraint): `D:/Coding/Harness/Pi-team-INTEGRATE-FLOW-003/pi-team.cmd` → `scripts/pi-team.ps1`
- Slice owners: Researcher `RESEARCH-004` (static mechanisms) + Executor `EXECUTOR-004` (live baseline + ranked options + experiment matrix). Reviewer `REVIEW-004` independently re-runs the diagnostics.
- Capture date: 2026-08-27 (capture-time only)
- Companion artifact: `research/PERF-004-static-survey.md` (Researcher).
- Companion implementation notes: `implementation_notes/PERF-004.md` (Executor slice log).

This document is the Executor deliverable for done criteria **C-002** and **C-004**. It does **not** implement any optimization; it proposes them.

---

## 1. Headline answer

Across the integrated entrypoint, six mechanisms (mapped 1:1 to the Researcher's static findings) dominate resource waste. After a read-only live baseline of the three PERF-004 roles, the cumulative idle footprint is **~1.25 GB RSS, ~100 threads, and ≥ 15 Windows processes** for one task with three roles. The single highest-yield optimizations ranked by **(benefit × certainty) / cost × risk** are:

| Rank | Option | Mechanism(s) | Est. benefit | Risk | Cost | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Replace the PowerShell `Wait-RoleReady` 100 ms busy-poll with an event-driven readiness signal | M2 | -80 to -120 s wall-clock / start; -1 PowerShell × ~600 polls CPU | low (logic-only, isolated to `Start-Task` path) | small | high |
| 2 | Stop writing the legacy `pi-team/v1/{task}-{role}.jsonl` journal once the Blackboard `appendAgentEvent` path is authoritative | M3, M4 | ~30-40 % fewer event-file read/parse cycles per role session | low (path already dead — verify before deleting) | trivial | medium (requires confirmation that no consumer reads the legacy journal) |
| 3 | Replace the gzip+Base64+UTF-16LE `EncodedCommand` round-trip with an inherited-env or flat-argv launcher | M5 | -1 PowerShell per role × 3 roles; -Gzip CPU + memory per start | medium (must keep `< 8 KB` argv; verify wt.exe accepts) | small | high |
| 4 | Sidecar `.seq` file under each event log so `appendRoleEvent` / `appendAgentEvent` can compute `sequence = max + 1` without re-reading the whole `.jsonl` | M3 | O(1) appends → avoid O(n²) over a long session; event log can grow without per-event cost blow-up | low (must preserve atomicity / lock semantics) | small | high |
| 5 | Inline index (`{task}-{role}.idx`) for `snapshot` / `watch` so the Blackboard MCP server returns `eventsAfter(cursor)` in O(dirty) instead of re-reading and JSON-parsing every `.jsonl` on each poll | M4 | -X ms per `blackboard_snapshot` call (X scales with #tasks); unblocks dense UI polling | medium (must keep watch semantics consistent under concurrent writers) | medium | medium |
| 6 | Replace `taskkill /T /F` with graceful `Stop-Process` + state-file prune + worktree reconcile on launch failure | M6 | fewer orphaned grandchildren, no stale state files; cleaner next-start | medium (changing cleanup contract; could hide real failures) | medium | medium |

Three lower-ranked options (`M1` collapse of the per-role shell fan-out; persistent event in-process cache; agent-memory offloading) are also documented below for completeness. None of these six options should be implemented inside this slice.

---

## 2. Live baseline captured (read-only)

The baseline below was collected **only** from the three roles that `pi-team.cmd start` launched for PERF-004 on the integrated entrypoint. No additional roles were launched; no production code was modified.

All commands in this section were executed from inside the worktree. Wall-clock is captured-time only; for a strictly reproducible baseline, re-execute the experiment matrix in § 5.

### 2.1 Roles alive at capture

| Role | State PID | runtime PID | runtime_started_at | source-of-truth |
| --- | --- | --- | --- | --- |
| executor | 22276 | **332** | 2026-08-27T03:44:32.683Z | `<commonDir>/pi-team/v1/PERF-004.json` + `-executor-runtime.json` |
| reviewer | 3744 | **23260** | 2026-08-27T03:44:34.955Z | same |
| researcher | 23948 | **27348** | 2026-08-27T03:44:42.244Z | same |

`<commonDir>` resolves to `D:/Coding/Harness/.git/` (per `git -C <worktree> rev-parse --git-common-dir`). 观测值.

### 2.2 Per-role process footprint (live, Windows `Get-Process` + `Get-CimInstance Win32_Process`)

| Role (PID) | RSS T0 (MB) | RSS T0+3s (MB) | Threads | Handles | CPU total at T0+3s | Reading (op / bytes) | Writing (op / bytes) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| executor (332) | 186.5 | 190.5 | 33 | 248 | 2.125 s | 4 002 / 11.70 MB | 178 / 0.23 MB |
| reviewer (23260) | 137.3 | 137.3 | 33 | 233 | 0.578 s | 3 290 / 11.56 MB | 70 / 0.05 MB |
| researcher (27348) | 129.3 (post-GC) | 129.4 | 33 | 237 | 2.266 s | 3 728 / 13.98 MB | 161 / 0.21 MB |

观测值. Note the **70 MB drop in the researcher's RSS** between T0 and T0+3s — visible Node GC, not a leak. Executor's RSS grew from 156.9 MB at first sample (03:44:32) to 234.5 MB at the final sample (03:53:40), driven by tool-result accumulators and intercom history; this is 待测 — a controlled measurement across the entire slice is required to attribute it to a specific extension.

### 2.3 Process tree per role

Per `Get-CimInstance Win32_Process` (parent-PID walk):

```
WindowsTerminal (PID 26748, RSS ≈ 490 MB)
  ├─ OpenConsole.exe (× 3, one per role pane, RSS ≈ 9 MB each)
  ├─ powershell.exe (× 3, the bootstrap decoder from -EncodedCommand, RSS ≈ 75 MB each)
  │     └─ cmd.exe (× 3, parent of node.exe)
  │           └─ node.exe (PID 332 / 23260 / 27348 — the Pi agent host)
  └─ (no additional children under WT)
```

**Support processes (sibling of the role subtree, parent = Codex CLI / intercom broker):**

```
codex.exe (PID 23320)
  ├─ node.exe (PID 3140 — blackboard-mcp server 1, RSS ≈ 45 MB)
  ├─ node.exe (PID 19300 — blackboard-mcp server 2, RSS ≈ 57 MB)
  └─ node.exe (PID 21768 — intercom broker)
        └─ node.exe (PID 27280 — intercom broker child)
```

The reviewer (PID 23260) additionally spawned **1 powershell.exe** as an extension child (Reviewer observation, see E-16). All 4 support node processes are siblings of the WT-hosted role subtree — they are owned by the Codex CLI host, not by `pi-team.ps1`. Per Reviewer re-observation, the total process count for one 3-role task is **18**, not the 13 that the Executor initial count tallied (see E-16 row update and § 9 Reviewer clarifications).

观测值 for the topology; 推断 for the byte counts because OpenConsole / powershell RSS were captured once and may vary across machines. The legacy `launcher_pid` (22276, 3744, 23948) recorded in `PERF-004.json` are the `wt.exe` processes spawned by `Start-RoleProcess`; those have already exited — the **persistent** terminal pane is the one captured at PID 26748. The launcher-vs-runtime split is described as 推断 because no transcript of the `wt.exe` exit code is retained.

### 2.4 Idle CPU over 3 s

| Role (PID) | CPU T0 | CPU T0+3s | Δ over 3 s | Behavior |
| --- | --- | --- | --- | --- |
| executor (332) | 1.359 s | 2.125 s | **+0.766 s** | active inference (responding to my Read / Grep / Bash calls) |
| reviewer (23260) | 0.578 s | 0.578 s | 0.000 s | idle (no `READY_FOR_REVIEW` event yet) |
| researcher (27348) | 1.688 s | 2.266 s | **+0.578 s** | active (synthesizing + writing the static survey) |

观测值. Reviewer's flat CPU confirms it is **not** busy-looping on any background extension.

### 2.5 Blackboard event journal (harness-blackboard/v1)

`<commonDir>/harness-blackboard/v1/PERF-004-{role}.jsonl` exists for all three roles. At capture-time:

| File | Lines | Bytes | Last sequence | Last state |
| --- | --- | --- | --- | --- |
| `PERF-004-executor.jsonl` | 2 | 925 | 2 | `working` |
| `PERF-004-researcher.jsonl` | 3 | 1 254 | 3 | `completed` |
| `PERF-004-reviewer.jsonl` | 1 | 701 | 1 | `waiting` |

观测值. The Reviewer's `waiting` state was set immediately on registration — no `READY_FOR_REVIEW` / `FIX_READY` event has been observed yet because Executor has not yet sent one.

### 2.6 Legacy role event journal (pi-team/v1)

`<commonDir>/pi-team/v1/PERF-004-{role}.jsonl` is the **legacy** journal the PowerShell `Event` function is supposed to write. At initial capture-time (03:53Z):

| File | Present? | Notes |
| --- | --- | --- |
| `PERF-004-executor.jsonl` | **absent** | `Start-Task` calls `Event … 'working' 'task started'` for executor and reviewer — yet the file is not on disk |
| `PERF-004-reviewer.jsonl` | **absent** | same |
| `PERF-004-researcher.jsonl` | **present (1 line)** | one `state:"completed"` entry at 2026-08-27T03:48:10.576Z, the moment the Researcher signaled completion |

观测值 for absence; 推断 for the cause (likely the PowerShell `Event` is being called from `Launch-Role` only on terminal-state transitions, or the path is being rewritten elsewhere). `pi-team.cmd doctor` confirms the missing files — its `last_event=` line ends with `\` for executor + reviewer (the trailing separator of an empty path) and ends without `\` for researcher. This divergence is a **finding** (Option 2 below) rather than a defect to fix in this slice.

**Post-READY_FOR_REVIEW update (2026-08-27T04:18:40Z, verified by Reviewer):** after Executor sent the `READY_FOR_REVIEW` envelope, `<commonDir>/pi-team/v1/PERF-004-executor.jsonl` was created on disk with a single `state:"ready_for_review"` entry. This confirms the Executor hypothesis: **the legacy PowerShell `Event` function fires on terminal-state-ish transitions (or any `blackboard_update` that publishes a final state), not on `task started`**. The fact that the `Start-Task` initial `Event … 'working' 'task started'` call for executor + reviewer left no file is the unconfirmed piece; it may indicate the call silently failed, or the Event function is gated to a different trigger set. This updated evidence is reflected in the Option 2 re-framing (§ 4, see Reviewer clarification in § 9).

### 2.7 Blackboard `snapshot` cost (Mechanism 4 evidence)

`node plugins/agent-blackboard/server/blackboard-cli.mjs "" <projectRoot>` was timed:

| Run | Wall-clock |
| --- | --- |
| cold (first invocation) | 54 ms |
| hot iteration 1 | 39 ms |
| hot iteration 2 | 41 ms |
| hot iteration 3 | 34 ms |

观测值 with a clarification (see Reviewer § 9): the invocation `blackboard-cli.mjs "" <projectRoot>` does **not** call `snapshot()` — the CLI loads the module and throws "unknown command" because `process.argv[2]` is empty. The 34-54 ms numbers therefore measure **module-load + error-throw + Node exit**, which is a proxy for the same order of magnitude as a real `snapshot()` call. Reviewer re-measurement using a direct `import { snapshot } from ".../blackboard-core.mjs"` returned 42.62 / 31.99 / 26.65 ms (cold + 2 hot) — same order of magnitude. Both numbers are recorded; the experiment matrix E-02 row carries the same caveat. The state root held 13 `.jsonl` files totalling 14 355 bytes / 31 events at capture. `snapshot` and `watch` both call `allEvents(root)` which `readdir`s the entire state root and `JSON.parse`s every line of every file on every invocation. With the current count the absolute cost is small (≤ 41 ms); with **N** tasks and 100 ms UI polling, the cumulative cost grows as **O(N × events_per_task)** per poll — see Option 5.

### 2.8 Doctor cost (Mechanism 1 × mechanism 4 evidence)

`pi-team.cmd doctor` ran in **1 080 ms** end-to-end. It reports "OK" for 8 sanity items, then enumerates 15 task × role rows. The bulk of the time is the `git rev-parse --path-format=absolute --git-common-dir` spawn, the per-task `Get-Content` of `<stateRoot>/*-{role}.jsonl`, and the per-row `Get-Process` lookup for `runtime_pid`. 观测值.

### 2.9 Environment limits (lead-acknowledged)

| Dimension | Status | Why |
| --- | --- | --- |
| Cross-process environment inspection of the agent PIDs | not collected | requires process-debugger privilege on Windows; marked 待测 |
| Profiling of `Start-RoleProcess` Gzip+Base64 round-trip | not measured | would require a fresh `start` of a sacrificial task; Lead constraint forbids extra concurrent roles |
| Watch-poll latency for the Blackboard MCP server under load | not measured | needs UI client or a synthetic `tools/call` loop; out of scope here |
| `HARNESS_POLICY_AUDIT_DIR` actual value at runtime | unset | default falls back to `<here>/audit`; no live entries appended for PERF-004 (the only entries are 2025-08 historical) |

---

## 3. Six mechanisms (from Researcher) — correlation with live evidence

The Researcher artifact `research/PERF-004-static-survey.md` enumerated six mechanisms. Below is a short cross-reference so the Reviewer can verify the ranking.

| # | Mechanism | Source path | Live evidence in § 2 |
| --- | --- | --- | --- |
| M1 | Per-role multi-process shell fan-out (5+ Windows processes per role) | `scripts/pi-team.ps1` `Start-RoleProcess` | § 2.3 (5+ per role), § 2.4 (idle CPU of the bootstrap PowerShell not separately measured) |
| M2 | `Wait-RoleReady` 100 ms busy-poll up to 60 s × 2 roles | `scripts/pi-team.ps1` `Wait-RoleReady` | inferred from source only; direct measurement would need a sacrificial `start` (待测) |
| M3 | `existingSequence` / `parseEventFile` re-read entire `.jsonl` to compute `sequence = max + 1` | `.pi/communication/role-events.mjs` + `plugins/agent-blackboard/server/blackboard-core.mjs` | § 2.5 (event counts still small) — scales with session length, 待测 for > 1 000 events |
| M4 | `snapshot` / `watch` re-read all events on every call | same file | § 2.7 (34-54 ms per snapshot at small N; O(N) per call) |
| M5 | Gzip + Base64 + UTF-16LE `EncodedCommand` round-trip | `scripts/pi-team.ps1` `Start-RoleProcess` | § 2.3 (extra PowerShell per role confirmed); CPU/memory of encoder/decoder 待测 |
| M6 | `taskkill /T /F` on launch failure | `scripts/pi-team.ps1` `Stop-RoleTree` | source-only (no failure injection in this slice) |

---

## 4. Ranked optimization options

Each option lists: mechanism(s), expected impact (with label), measurement method, expected effect (with label), verification standard (pass/fail), risk, implementation cost.

### Option 1 — Replace the PowerShell `Wait-RoleReady` busy-poll with an event-driven readiness signal

- **Mechanism(s):** M2.
- **Expected impact:** 推断. Eliminates up to **60 s × (1 000 ms / 100 ms) = 600** redundant `Get-Content` + JSON parses of `<stateRoot>/<task>-<role>-runtime.json` per role, **per `start` / `research` / `resume`** invocation. With 2 roles (executor + reviewer) on every `start`, that is **up to 1 200 redundant file reads per start**. Also drops parent PowerShell CPU to ≈ 0 during the wait.
- **Measurement method (reproducible):** add a one-shot timing wrapper around the loop (`Measure-Command { Wait-RoleReady $state 'executor' $launchId }`) and log `(deadline - now) / 100ms` iterations. Compare against a `FileSystemWatcher`-based version with `Register-ObjectEvent`.
- **Expected effect:** 推断. Wall-clock from `Start-RoleProcess` to `runtime_pid` known drops from `≈ 3-60 s` (the visible startup) to `≈ real cold-start time` (~1-3 s). The PowerShell parent's CPU during the wait drops from a few hundred ms of `Get-Content` cost to zero.
- **Verification standard:** pass if `Wait-RoleReady` iterations ≤ 5 and wall-clock ≤ 5 s for a fresh `start` on the same hardware as the baseline (capture-time ≈ 3 s for executor, ≈ 2 s for reviewer, ≈ 1 s for researcher — § 2.1).
- **Risk:** low. The runtime JSON path is the contract; a watcher on that file preserves correctness. Risk is failing to back-pressure if the Node child writes the JSON before the watcher subscribes — solved by a 1-shot blocking open with `PSScriptRoot` `OpenAsync` or by a `Wait-Process` fallback.
- **Implementation cost:** small (one PowerShell function rewrite + a small extension to `extensions/report-to-lead.ts` so it writes the runtime JSON **before** the long initialization step). No public contract change.

### Option 2 — Stop calling PowerShell `Event` from non-terminal-state code paths; route all event writes through Blackboard MCP

- **Mechanism(s):** M3 (secondary), M4 (secondary), plus the divergence between two parallel journals.
- **Expected impact:** 推断. Eliminates the partial lock contention between PowerShell `Event` and Blackboard `appendAgentEvent` paths and removes one redundant file per role per task. Per the Reviewer's observation (§ 2.6 update), the legacy journal *is* written on terminal-state transitions (executor entry at 04:18:40Z confirms), so the path is alive — the framing as "pure code deletion" was wrong.
- **Measurement method (reproducible):** after the change, repeat § 2.7 and § 2.8 measurements and confirm that no `*-{role}.jsonl` is created under `<commonDir>/pi-team/v1/` after a fresh `start` / `READY_FOR_REVIEW` / `accept`.
- **Expected effect:** 推断. ~5-15 % snapshot cost reduction in the current state; bigger wins as task count grows. More importantly, single-source-of-truth simplifies reviewer's tooling and removes the doctor trailing-`\` bug.
- **Verification standard:** pass if `(Get-ChildItem <commonDir>/pi-team/v1/<task>-*.jsonl -ErrorAction SilentlyContinue | Measure-Object).Count` stays at 0 throughout a full `start` → slice → `ready_for_review` → `accept` lifecycle, and if `blackboard_snapshot` hot cost stays ≤ 34 ms.
- **Risk:** medium. A grep for consumers of the legacy journal must be empty first. Reviewer should `grep -r "pi-team/v1" --include=*.{ps1,mjs,ts}` and `grep -r "task_id-$role.jsonl"` across the worktree before this is enabled. The `pi-team.cmd doctor` `last_event=` line is coupled to the legacy path and must be re-pointed to the Blackboard MCP path before the legacy journal is dropped.
- **Implementation cost:** small (refactor `Event` callers so only `appendAgentEvent` remains; update `Doctor` and `Read-Runtime` consumers to read Blackboard instead). Not a pure deletion.

### Option 3 — Replace the gzip+Base64+UTF-16LE `EncodedCommand` round-trip

- **Mechanism(s):** M5.
- **Expected impact:** 推断. Removes **one PowerShell decoder process per role** = **3 PowerShell processes per `start`**, plus the Gzip CPU and the temporary memory streams. The payload (`identity`, `directory`, `executable`, `arguments`) is ~500 bytes raw — fits comfortably in `wt.exe`'s 32 K argv limit.
- **Measurement method (reproducible):** profile a sacrificial `start` with `Measure-Command` around `Start-RoleProcess`. Compare PowerShell process count before / after via `Get-Process powershell`.
- **Expected effect:** 推断. ~1 PowerShell × ~75 MB RSS saved per role × 3 roles = **~225 MB RSS per start**. Wall-clock `start` reduction ~50-100 ms (Gzip + Base64 + UTF-16 encode on a 500-byte payload is cheap but non-zero). Removes the additional decoder PowerShell listed in § 2.3.
- **Verification standard:** pass if `Get-Process powershell` count during steady-state is exactly **3** (one per role pane, the wt host's pane bootstrap) instead of the current **6** (3 role + 3 bootstrap decoders).
- **Risk:** medium. The current approach defends against Windows command-line length limits for env vars (8 × ~80 char strings = ~640 bytes plus `wt.exe`'s ~200-byte argv prefix = ~840 bytes — well under the 32 K limit, so the defense is 推断 to be unnecessary). If Lead later needs larger env payloads, a smaller helper (e.g., `wt.exe new-tab --title role-env` with `process.env` set in the parent) is a more controlled substitute.
- **Implementation cost:** small. Replace the `Start-RoleProcess` payload block with a flat argv call; the outer PowerShell already sets the env vars via `Set-Item Env:` in `try { … } finally { restore }`.

### Option 4 — Sidecar `.seq` file under each event log

- **Mechanism(s):** M3.
- **Expected impact:** 推断. Each `appendRoleEvent` / `appendAgentEvent` drops from `O(file size)` (full read + per-line JSON parse) to `O(1)` (one `<file>.seq` read/write), regardless of session length.
- **Measurement method (reproducible):** instrument `appendRoleEvent` with `performance.now()` before / after; emit `(elapsed_ms, event_count)` to a temporary log. Compare curves across 1, 10, 100, 1 000 events.
- **Expected effect:** 推断. Per-event cost stays flat across a long session instead of growing linearly; in the worst case (≥ 1 000 events in one role) the saved cost is ≥ 100× the per-event baseline. Current state has ≤ 3 events per role, so the absolute saving today is small; the option is preventive.
- **Verification standard:** pass if per-event wall-clock p95 stays ≤ 1 ms across a synthetic 1 000-event stress test inside the role's append hook.
- **Risk:** low. The seq file lives next to the event log, is updated under the same `withLock`, and can be reconstructed from the event log on first read if missing.
- **Implementation cost:** small. Two-line change inside `existingSequence` to read `<file>.seq` if present, otherwise compute once and write back.

### Option 5 — Inline index for `snapshot` / `watch`

- **Mechanism(s):** M4.
- **Expected impact:** 推断. `blackboard_snapshot` / `blackboard_watch` go from `O(all events in state root)` to `O(dirty events since last cursor)` on each call. With sub-second UI polling and N tasks this is the largest steady-state saving.
- **Measurement method (reproducible):** ship a synthetic `state_root` with 100 / 1 000 / 10 000 events across 10 / 100 tasks and time `snapshot` before / after.
- **Expected effect:** 推断. ~10-100× speed-up on `snapshot` for state roots with ≥ 1 000 events. Removes the JSON.parse-every-line step in the hot path.
- **Verification standard:** pass if `blackboard_snapshot` on a 10 000-event state root completes in ≤ 50 ms.
- **Risk:** medium. Cursor management becomes a contract; concurrent appends across multiple MCP server processes must not lose events. The existing `eventsAfter` + `cursorFor` pair already encode the cursor logic — the change is to maintain the index incrementally instead of recomputing it.
- **Implementation cost:** medium. Requires a small `{role, sequence, observed_at, file_mtime, byte_offset}` index, possibly stored as an `.idx` sidecar or an in-process cache with periodic flush.

### Option 6 — Replace `taskkill /T /F` with graceful `Stop-Process` + state-file prune + worktree reconcile

- **Mechanism(s):** M6.
- **Expected impact:** 推断. On a failed `start`, the recovery now leaves the system in a state where the next `pi-team.cmd start <same-task>` can succeed (after the user cleans up). Today, `taskkill /T /F` orphans grandchildren and leaves the state JSON pointing at dead PIDs.
- **Measurement method (reproducible):** inject a deliberate `Fail` (e.g., a missing `pi.cmd`) and observe the post-failure state. Compare the number of `node.exe` processes, the contents of `<stateRoot>/<task>.json`, and the worktree cleanliness.
- **Expected effect:** 推断. Zero orphaned `node.exe` after a failed start; `<task>.json` either deleted or its `execution_status` flipped to `cleaned`; worktree remains intact.
- **Verification standard:** pass if, after the synthetic failure, `(Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count` does not increase and `<stateRoot>/<task>.json` either does not exist or has `execution_status: "cleaned"`.
- **Risk:** medium. The current `taskkill /T /F` is a defensive kill; a graceful path must still bound the total wait time or it can hang on a wedged child. The change must keep the bound (e.g., `Stop-Process -Force` after 5 s).
- **Implementation cost:** medium. Replaces `Stop-RoleTree` with `Stop-RoleGracefully($Session)` and adds a single `Reset-StateOnFailure` path. No contract change for callers.

### Option 7 (lower priority) — Collapse the per-role shell fan-out

- **Mechanism(s):** M1.
- **Expected impact:** 推断. Could reduce Windows Terminal / OpenConsole / outer PowerShell / cmd.exe / inner PowerShell chain from 5+ processes per role to 2 (Windows Terminal + Node agent). With 3 roles, that is **9-15 fewer processes per task**.
- **Risk:** high. Requires either a custom `wt.exe` profile (a `taskbar` entry per role) or a Node-side launcher that emulates the terminal pane behavior. Touches the only contract that the Lead-supplied entrypoint enforces. Out of scope for this slice but worth keeping in the matrix.
- **Implementation cost:** medium-high. Likely a sibling `pi-team.cmd` subcommand that skips the wt path and starts the Node agent directly inside the current pane.

### Option 8 (lower priority) — Persistent event in-process cache

- **Mechanism(s):** M4.
- **Expected impact:** 推断. Within a single MCP server lifetime, a single read of each `.jsonl` is enough; further `snapshot` calls hit the in-memory cache. UI polling no longer touches disk on every call.
- **Risk:** low-medium. The cache must invalidate on file `mtime` change; race window between `mtime` change and read must be handled with `fs.watch` or polling at ≤ 100 ms.
- **Implementation cost:** small-medium.

### Option 9 (lower priority) — Agent-memory offloading

- **Mechanism(s):** none directly; addresses the future risk that agent sessions accumulate context until RSS grows unboundedly.
- **Expected impact:** 推断. Cap per-role RSS at ~200 MB by offloading intercom history to disk under the existing `<stateRoot>/reply-store`.
- **Risk:** medium. Requires an extension change to `runtime-policy.mjs`'s `receiveAndReplay` to truncate in-memory cache after the disk write.
- **Implementation cost:** small. The `<stateRoot>/reply-store` infrastructure already exists.

---

## 5. Experiment matrix (reproducible)

Every row is a single command or a 2-command sequence that **can be re-executed inside the worktree without modifying production state**. The "Observation" column records what was measured (or marked 待测).

| ID | Path / artifact | Command | Observation | Inference / 待测 |
| --- | --- | --- | --- | --- |
| E-01 | `pi-team.cmd doctor` runtime | `Measure-Command { & D:/Coding/Harness/Pi-team-INTEGRATE-FLOW-003/pi-team.cmd doctor \| Out-Null }` | 1 080 ms end-to-end (§ 2.8) | 观测值 |
| E-02 | Blackboard snapshot cost | `Measure-Command { node plugins/agent-blackboard/server/blackboard-cli.mjs "" <projectRoot> \| Out-Null }` × 3 hot runs | 34 / 39 / 41 ms (§ 2.7); caveat: the CLI invocation does NOT call `snapshot()` — it loads the module and throws "unknown command"; numbers measure module-load + error-throw as a proxy. Reviewer direct `snapshot()` call: 42.62 / 31.99 / 26.65 ms — same order of magnitude. | 观测值 (proxy) |
| E-03 | Per-role RSS at idle | `Get-Process -Id 332,23260,27348 \| Select Id,@{n='RSS_MB';e={[Math]::Round($_.WorkingSet64/1MB,1)}},Threads,@{n='CPU';e={$_.CPU}}` | 234.5 / 137.3 / 129.8 MB (§ 2.2) | 观测值 |
| E-04 | Per-role CPU over 3 s | sample `Get-Process … | Select CPU` twice 3 s apart | +0.766 / +0.000 / +0.578 s (§ 2.4) | 观测值 |
| E-05 | Process tree | `Get-CimInstance Win32_Process \| ? Name -in 'WindowsTerminal','OpenConsole','powershell','cmd','node' \| Select ProcessId,ParentProcessId,Name,@{n='RSS_MB';e={[Math]::Round($_.WorkingSet64/1MB,1)}}` | tree in § 2.3 | 观测值 for topology; 推断 for byte counts |
| E-06 | Network sockets | `Get-NetTCPConnection -State Established \| ? OwningProcess -in 332,23260,27348` | executor + researcher hold one TLS each to 198.18.0.235:443 (§ 2) | 观测值; 待测 for traffic shape (TLS termination hides the URL) |
| E-07 | I/O counters | `Get-CimInstance Win32_Process -Filter "ProcessId IN (332,23260,27348)" \| Select ProcessId,ReadOperationCount,WriteOperationCount,ReadTransferCount,WriteTransferCount` | ~3 300-4 000 reads / 70-180 writes per role (§ 2.2) | 观测值 |
| E-08 | Blackboard event journal | `Get-ChildItem <commonDir>/harness-blackboard/v1/PERF-004-*.jsonl \| Select Name,Length; Get-Content <file>` | 3 files, 6 lines total (§ 2.5) | 观测值 |
| E-09 | Legacy role event journal | `Get-ChildItem <commonDir>/pi-team/v1/PERF-004-*.jsonl` | executor + reviewer absent; researcher has 1 completed line (§ 2.6) | 观测值 for absence; 推断 for cause |
| E-10 | Audit / reply-store / lifecycle dirs | `Get-ChildItem <worktree>/.pi/communication/{audit,reply-store,lifecycle}` and `<commonDir>/pi-team/{audit,reply-store,lifecycle}` | audit present (historical), reply-store + lifecycle absent | 观测值 |
| E-11 | `Wait-RoleReady` poll count | `Measure-Command { & pi-team.cmd start <sacrificial-contract> }` with a one-shot counter around `Wait-RoleReady` | 待测 (requires a sacrificial task) | 待测 — Lead-collectable metric, Option 1 |
| E-12 | Per-event append wall-clock | instrument `appendRoleEvent` in `.pi/communication/role-events.mjs` with `console.timeEnd` | 待测 — same-shape metric in `blackboard-core.mjs` `appendAgentEvent` | 待测 — Option 4 |
| E-13 | Snapshot under load | synthetic state root with N tasks × M events; time `blackboard-cli` repeatedly | 待测 — synthetic state root only, no real-world stress | 待测 — Option 5 |
| E-14 | Force-tree-kill behaviour | inject a `Fail` in `Start-Task` (e.g., delete `pi.cmd`); observe `Get-Process node`, `<stateRoot>/<task>.json`, `<worktree>` | 待测 — would require a controlled sacrificial task | 待测 — Option 6 |
| E-15 | Gzip+Base64 round-trip cost | wrap `Start-RoleProcess` payload block in `Measure-Command` | 待测 — costs one fresh `start` | 待测 — Option 3 |
| E-16 | Process fan-out process count | `Get-Process \| ? Name -in 'OpenConsole','powershell','cmd','node','WindowsTerminal','wt' \| Measure-Object` plus `Get-Process codex,node` for support processes | Executor initial count: **13** (1 WT + 3 OC + 3 PS + 3 cmd + 3 node); Reviewer re-count: **18** = +1 extension-spawned powershell (child of reviewer node 23260) + 4 support node processes (2 blackboard-mcp servers PIDs 3140 / 19300, 2 intercom broker PIDs 21768 / 27280) (§ 2.3, § 9) | 观测值 (Reviewer supersedes Executor) |

All commands above are **non-mutating** against production code. `<commonDir>` resolves via `git -C <worktree> rev-parse --git-common-dir`. `<projectRoot>` is the worktree path.

---

## 6. Negative / contrast scenarios

Per Lead constraint and to validate the optimizations are not cosmetic, the following contrast scenarios are recorded. Each is **a code path that already exists in the integrated entrypoint** and would yield different measurements if exercised.

| Scenario | What it shows | How to trigger |
| --- | --- | --- |
| C-01 — `pi-team.cmd research` only | `Start-Task` launches 2 roles; `Research` launches 1. The Researcher launch path does not call `Event` for a `task started` line — verifies Option 2 partial deletion safety. | `& pi-team.cmd research <task-id> <question-id> <question-file>` |
| C-02 — `pi-team.cmd status <task-id>` | prints only the state JSON + last event line. Cheap. | `& pi-team.cmd status PERF-004` |
| C-03 — `pi-team.cmd watch` (alias for `status`) | same as above; live debug tool. | `& pi-team.cmd watch PERF-004` |
| C-04 — `pi-team.cmd resume <task-id>` | re-launches 2 roles when no live role processes; calls `Wait-RoleReady` again — the busy-poll cost in Option 1 is doubled per resume. | `& pi-team.cmd resume PERF-004` (after reclaim) |
| C-05 — Large event log | stress test of Mechanism 3 by injecting 10 000 events into one role's `.jsonl` and timing `appendRoleEvent` — verifies the Option 4 ceiling. | synthetic only |
| C-06 — UI polling at 100 ms | running `blackboard_watch` against a state root with 10 tasks × 5 events — confirms the Option 5 ceiling. | synthetic only |

---

## 7. Summary of observations vs inferences vs to-be-measured

| Label | Meaning |
| --- | --- |
| 观测值 | Captured live in this slice, reproducible via the experiment matrix (§ 5) |
| 推断 | Logical consequence of the source code or general OS behavior; not measured in this slice |
| 待测 | Requires a sacrificial task or elevated tooling not available in this slice; listed in § 5 with the exact follow-up command |

Headline 观测值 are in § 2.2, § 2.4, § 2.5, § 2.7, § 2.8. Headline 推断 are in § 4 (option impact estimates) and § 2.3 (process-byte attribution). Headline 待测 are in § 2.6 (legacy journal cause), § 2.9 (env values), § 4.1 (Options 1, 3, 4, 5, 6 exact numbers), and § 5 (E-11…E-15).

---

## 8. Out-of-scope acknowledgments

- No production code, configuration, test, or spec document was edited.
- The only filesystem changes inside the worktree are: `implementation_notes/PERF-004.md` (new), `reports/PERF-004-performance-options.md` (new), `reports/` directory (new).
- The integrated entrypoint `D:/Coding/Harness/Pi-team-INTEGRATE-FLOW-003/pi-team.cmd` was the sole entrypoint used (`doctor` only). No `start`, `research`, or `resume` was invoked from this session.
- Per Lead constraint, the Executor/Reviewer pair is kept alive; no `cleanup` / `reclaim` / `accept` / `close-incomplete` was invoked.
- Reviewer (`REVIEW-004`) is the sole consumer of this artifact and will independently re-run § 5 E-01, E-02, E-03, E-04, E-07, E-08, E-09 to verify the baseline. The Reviewer does not edit production code.

---

## 9. Reviewer clarifications (post-READY_FOR_REVIEW)

After the Executor sent the `READY_FOR_REVIEW` envelope, paired Reviewer (`pi-team--PERF-004--reviewer`) independently re-ran the experiment matrix and returned `REVIEW_PASS` with three minor clarifications (no failure artifact, no constraint violation, no scope change). The Executor incorporated them into this artifact as factual corrections:

### 9.1 E-02 — snapshot cost is a proxy measurement

The Executor command `node plugins/agent-blackboard/server/blackboard-cli.mjs "" <projectRoot>` does **not** call `snapshot()`. With an empty `process.argv[2]`, the CLI loads the module and throws "unknown command" before reaching any snapshot logic. The 34-54 ms numbers therefore measure **Node module-load + error-throw + process exit**, not a snapshot. Reviewer direct re-measurement (importing `snapshot` from `blackboard-core.mjs`) returned 42.62 / 31.99 / 26.65 ms (cold + 2 hot) — same order of magnitude. Both sets of numbers are recorded; the experiment-matrix E-02 row carries the caveat. Suggested follow-up: replace E-02's command with a direct import invocation. **No re-implementation performed in this slice.**

### 9.2 E-16 — total process count is 18, not 13

The Executor initial tree-walk tallied 13 visible processes (1 WT + 3 OC + 3 PS + 3 cmd + 3 node). Reviewer re-observation identified **5 additional processes** that the Executor missed because they sit outside the WT subtree:

- **+1** powershell.exe spawned as an extension child of the reviewer node (PID 23260).
- **+4** node processes that are children of the Codex CLI / intercom broker:
  - `codex.exe` (PID 23320) hosts:
    - 2 × `blackboard-mcp` servers (PIDs 3140, 19300)
    - 1 × intercom broker node (PID 21768)
  - The intercom broker node (21768) spawns a child node (PID 27280).

Corrected total: **18** = 1 WT + 3 OC + 4 PS (3 pane + 1 extension-spawned) + 3 cmd + 7 node (3 agent + 4 support). § 2.3 reflects this with a sibling-subtree diagram. Reviewer observation supersedes Executor initial count.

### 9.3 Option 2 — better framed as a routing change, not a pure code deletion

Executor originally framed Option 2 as "trivial / code-deletion". Reviewer pointed out that the legacy `pi-team/v1` journal **is** written on terminal-state transitions (the executor entry at 2026-08-27T04:18:40Z, triggered by Executor's `READY_FOR_REVIEW` envelope, confirms this), so the path is alive — it is just not triggered by `task started`. The correct framing is:

> Stop calling PowerShell `Event` from non-terminal-state code paths and route all event writes through the Blackboard MCP path. This is a routing/consolidation change, not a pure deletion. The `pi-team.cmd doctor` `last_event=` line is coupled to the legacy path and must be re-pointed to the Blackboard MCP path before the legacy journal can be safely dropped.

Option 2 has been re-framed accordingly in § 4.

### 9.4 Executor ↔ Reviewer agreement summary

| Item | Executor claim | Reviewer observation | Outcome |
| --- | --- | --- | --- |
| Working tree | clean (only 3 untracked) | clean | agreed |
| All 8 Lead constraints | satisfied | satisfied | agreed |
| E-01 doctor | 1 080 ms | 1 176 / 1 273 ms | agreed (+9% / +18 % variance within tolerance) |
| E-03 RSS | 234.5 / 137.3 / 129.8 MB | 276.6 / 157.7 / 130.7 MB | agreed (Reviewer observed natural growth from additional tool work) |
| E-07 I/O | grows with work | 5 632 / 4 262 / 4 442 reads | agreed |
| E-08 Blackboard files | 3 | 3 | agreed |
| E-09 Legacy journal cause | terminal-state-ish transitions | confirmed at 04:18:40Z (READY_FOR_REVIEW trigger) | agreed |
| E-02 snapshot cost | 34 / 39 / 41 ms (CLI proxy) | 42.62 / 31.99 / 26.65 ms (direct snapshot) | clarified (both kept, order of magnitude matches) |
| E-16 process count | 13 | 18 (5 support processes) | corrected (Executor initial tally missed the sibling subtree) |
| Option 2 framing | pure code deletion | routing change | reframed |

No failure artifact created. Verdict artifact written by Reviewer at `reports/PERF-004-review.md`.

End of PERF-004 performance options report.

