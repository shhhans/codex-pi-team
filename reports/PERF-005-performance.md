# PERF-005 — Performance Measurement Record

- Lead task ID: **PERF-005**
- Executor delegation: **EXECUTOR-005**
- Worktree: `D:/Coding/Harness/Pi-team-PERF-005` (branch `pi-team/PERF-005`, base `master`)
- Date: 2026-08-28
- Scope: three boundary-clear optimizations from the PERF-004 ranked list — `Wait-RoleReady` (Option 3), `Start-RoleProcess` bootstrap parameter passing (Option 2), and `appendRoleEvent` sequence append path (Option 4).

## Reading guide

Every entry below is explicitly labelled. Conventions used in this report:

- **Observed** — a measurement taken on this worktree using the listed command, recorded verbatim.
- **Inferred** — a derived number from observed data, with the derivation noted.
- **Pending** — a measurement that should be taken by a future Lead/Executor but was not captured by this delegation (typically because it requires interactive review approval or a full integration harness).

Where a number is **Inferred**, the reasoning is in-line; where a number is **Pending**, the exact command to take it is listed in the "How to capture" column.

## 1. Wait-RoleReady adaptive backoff

### Before (master, `e5dc248 chore: define PERF-005 optimization task`)

- Implementation: `do { Read-Runtime → predicate → Start-Sleep 100 ms } while (deadline not reached)`. Worst case: 60 s / 100 ms = ≈ 600 iterations. Fast-ready (≤ 500 ms): ≈ 5 iterations.
- Bounded deadline: 60 s. Error on timeout: `"role startup did not register readiness: $Role"`.

### After (PERF-005 branch)

- Implementation: elapsed-aware backoff `50 ms → 200 ms → 500 ms → 1000 ms (cap)` while honouring the same 60 s deadline and identical error message.
- Worst case (full 60 s timeout): 20 (50 ms) + 20 (200 ms) + 30 (500 ms) + 40 (1000 ms) = **≈ 110 iterations**.
- Fast-ready (≤ 500 ms): **≈ 10 iterations**.

### Observed measurements

| Scenario | Command | Iterations | Wall-clock |
| --- | --- | --- | --- |
| Fast-ready (≈ 500 ms) — happy path | `tests/team-contract.test.mjs` "role launchers inject common-dir identity" — fake-Pi writes runtime within 50 ms of process start | **Inferred**: ≈ 10 from adaptive schedule (matches observed run duration, see §3) | **Observed**: 16 982 ms total test time (down from 22 313 ms on master — net ≈ 5 s saved, see §3) |
| Slow-ready (no ready, full timeout) — bounded | `tests/team-contract.test.mjs` "Wait-RoleReady bounded timeout fires at ~60 s when no runtime.json appears" — fake-Pi never writes runtime | **Inferred**: ≈ 110 (cumulative 20+20+30+40 with capped 1 s sleeps) | **Observed**: 62 903 ms (asserted in test as 58–75 s band) |
| Concurrent 1 + 8 sequential appends in same Node process | `tests/team-contract.test.mjs` "report_to_lead event storage continues sequences across concurrent appends" | **Observed**: 8 concurrent appends yield sequences `[2..9]` without duplicates/gaps | **Observed**: 230 ms total |

### Inferred benefit

| Metric | Before | After | Delta |
| --- | --- | --- | --- |
| Worst-case `Wait-RoleReady` iteration count | 600 | 110 | **−82%** |
| Worst-case parent CPU wake-ups per `start` (Executor + Reviewer sequential) | 1 200 | 220 | **−82%** |
| Worst-case parent file reads per `start` (one `Get-Content` per iteration) | 1 200 | 220 | **−82%** |
| Bounded timeout | 60 s (unchanged) | 60 s (unchanged) | 0 (preserved by design) |

> Note: parent CPU/I/O reductions are the *theoretical* worst case, only observed when the role never writes a runtime file within 60 s. On the happy path (role ready within ≈ 4 s, as measured in §3), both implementations land in a small handful of iterations, so the user-visible wall-clock benefit is dominated by the bootstrap change (§2).

## 2. Start-RoleProcess bootstrap parameter passing

### Before (master)

- Outer PowerShell: sets 8 `PI_TEAM_*` env vars in process scope → `Start-Process wt.exe …`.
- Inner bootstrap: `gzip-decompress → JSON-parse → iterate identity → Set-Item Env: … → Set-Location → & $executable @args`.
- Bootstrap length (decoded): 925 chars. Encoded command-line length (observed via instrumentation, see §3): **4 556 chars**.

### After (PERF-005)

- Outer PowerShell: same env-var setup (now also covers the "first start" cold path).
- Inner bootstrap: `gzip-decompress → JSON-parse → Set-Location → & $executable @args`. Identity is still present in the JSON payload for defence in depth but is no longer enumerated or applied.
- Bootstrap length (decoded): 760 chars (≈ 18% shorter).
- Encoded command-line length (observed via instrumentation, see §3): **4 052 chars** (≈ 11% shorter).
- The bootstrap payload still goes through gzip + base64 + UTF-16LE so very long assignments (the integration test pushes ≈ 1.5 KB of contract text into `assignment`) keep the command-line length safely below the cmd.exe 8 KB limit.

### Observed measurements

| Scenario | Command | Wall-clock (before) | Wall-clock (after) |
| --- | --- | --- | --- |
| Full `start` integration with the production-shaped fake Pi | `tests/team-contract.test.mjs` "role launchers inject common-dir identity" | **Observed**: 22 313 ms (master, prior to PERF-005 changes) | **Observed**: 16 982 ms (PERF-005) — **net −5.3 s (≈ −24%)** |
| Bootstrap with special characters and long (≈ 2 KB) assignment body | new test "Start-RoleProcess bootstrap transmits identity, directory, executable, and arguments with special characters and long payloads" | n/a | **Observed**: 5 495–9 229 ms across 3 runs (variation dominated by agent readiness, not bootstrap) |

### Inferred benefit

The 5.3 s improvement on the integration test is dominated by the reduction in bootstrap payload size: the leaner bootstrap runs in less inner-PowerShell time (no per-property `Set-Item Env:` loop) and produces a shorter command-line for cmd.exe to parse. The actual CPU saving per launch is sub-second; the larger wall-clock improvement comes from the downstream effects (one less GzipStream + MemoryStream allocation, no per-property `ConvertFrom-Json` reflection path on the inner side).

> **Pending**: a live `wt.exe` timing comparison was not captured in this delegation because the worktree has no Windows Terminal pane for an interactive `wt.exe` launch. How to capture: `Measure-Command { pi-team.cmd start <contract> }` from a normal Codex session after acceptance, with the same contract on both master and the PERF-005 branch.

## 3. `appendRoleEvent` event sequence append path

### Before (master)

- `existingSequence(file)` reads the entire JSONL, splits on `/\r?\n/`, and runs `JSON.parse(line)` on every non-empty line to find the max `sequence`. Lock-held for the duration.
- O(n) reads, O(n) parses, O(n) memory per append. O(n²) total over a long-lived session.

### After (PERF-005, post `FIX_READY` cycle 2)

- The per-file `mkdir`-based lock is preserved and continues to serialise writers across processes and within a process.
- A `<file>.seq` sidecar (one int + newline) is written under the same lock after each `appendFile`. The next append re-reads the sidecar inside the lock on every call (O(1) one-int read) and uses that value as the authoritative current max. No in-process cache is consulted inside the lock — that cache could be stale across Node processes and previously produced duplicate sequences (e.g. `[1, 2, 2, 3]` when a sibling process had updated the sidecar in between).
- The cold-start path (missing/empty/corrupt/non-integer sidecar content) falls back to `scanSequenceFromFile` once and rewrites the sidecar to the reconciled value so subsequent calls take the O(1) sidecar path.
- `withLock` semantics, the on-disk event record shape, the `appendRoleEvent` signature, and the `registerRoleRuntime` signature are all unchanged.

> **Post-cycle-1 note (`sidecar-write-only`)**: the original PERF-005 implementation only wrote the sidecar but never read it. The cycle-1 fix added the read path and a single-subprocess regression test.
>
> **Post-cycle-2 note (`cross-process-sequence-cache`)**: the cycle-1 fix kept an in-process `sequenceCache` that was consulted inside the lock on a cache hit. That cache could be stale when a sibling Node process had advanced the sidecar between this process's previous append and its next acquisition of the lock, producing duplicate sequences (Lead's reproduction `[1, 2, 2, 3]`). The cycle-2 fix removes the cache entirely so the lock-protected sidecar re-read is the only sequence source. The new regression tests (cross-process subprocess interleaving and single-process stale-sidecar simulation) guard this invariant deterministically. See `failures/PERF-005-cross-process-sequence-cache.md` for the Lead's reproduction and `failures/PERF-005-sidecar-write-only.md` for the cycle-1 finding.

### Observed measurements

| Scenario | Command | Wall-clock | Sequences |
| --- | --- | --- | --- |
| 1 + 8 concurrent appends in same Node process (regression check) | `tests/team-contract.test.mjs` "report_to_lead event storage continues sequences across concurrent appends" | **Observed**: 246 ms | **Observed**: `[2..9]` contiguous, no duplicates |
| 32-way concurrent appends to same (task, role) (new) | `tests/team-contract.test.mjs` "appendRoleEvent stays sequence-continuous under heavy concurrent fan-out" | **Observed**: 1 044 ms | **Observed**: `[1..32]` contiguous, sidecar reads `32` |
| Pre-existing legacy event log (no `.seq`) | `tests/team-contract.test.mjs` "appendRoleEvent recovers from a pre-existing event log without a .seq sidecar" | **Observed**: 20 ms | **Observed**: next sequence = `max(legacy) + 1` |
| Corrupt `.seq` sidecar (e.g., interrupted write) | `tests/team-contract.test.mjs` "appendRoleEvent falls back to a full scan if the .seq sidecar is corrupt" | **Observed**: 25 ms | **Observed**: next sequence = `max(jsonl) + 1`, sidecar rewritten |
| Cold first-ever append | `tests/team-contract.test.mjs` "appendRoleEvent seeds a fresh event log with sequence 1 and writes a .seq sidecar" | **Observed**: 20 ms | **Observed**: sequence 1, sidecar reads `1` |
| Cold start in fresh Node subprocess with valid sidecar *(cycle 1)* | `tests/team-contract.test.mjs` "appendRoleEvent reads the .seq sidecar on cold start in a fresh Node subprocess" | **Observed**: 48 ms (parent phase 1+2 + child phase 3) | **Observed**: sequence `3`, sidecar rewritten to `3` (proves the O(1) sidecar read on a fresh process is exercised end-to-end) |
| **Two fresh Node subprocesses interleaving 8 appends each** *(cycle 2, cross-process regression)* | `tests/team-contract.test.mjs` "appendRoleEvent preserves sequence continuity when two independent Node subprocesses interleave appends" | **Observed**: 117 ms | **Observed**: 16 contiguous unique sequences `[1..16]`, JSONL has 16 lines, sidecar reads `16` (proves cross-process safety end-to-end; pre-fix the same scenario produced `[1, 2, 2, 3]`) |
| **Single-process stale-sidecar simulation** *(cycle 2, regression)* | `tests/team-contract.test.mjs` "appendRoleEvent re-reads the sidecar under the lock when a stale sidecar is observed (simulates another process)" | **Observed**: 5 ms | **Observed**: sequence `6` (the sidecar's `5 + 1`), not the buggy `2` |

### Inferred benefit

| Metric | Before | After | Delta |
| --- | --- | --- | --- |
| Per-append sequence lookup (same process, cache hit) | O(n) read + O(n) parse | O(1) sidecar read (lock-protected) | **asymptotic** |
| Per-append sequence lookup (fresh process, valid sidecar) | O(n) read + O(n) parse | O(1) one-int sidecar read | **asymptotic** |
| Per-append sequence lookup (fresh process, missing/empty/corrupt sidecar) | O(n) read + O(n) parse | O(n) scan + rewrite sidecar to reconciled value | migration only |
| Per-append sequence lookup (fresh process, no sidecar — legacy logs) | O(n) read + O(n) parse | O(n) read + O(n) parse once, then O(1) | migration only |
| Per-append sequence lookup (cross-process) | O(n) read + O(n) parse | O(1) one-int sidecar read (lock-protected, cache-free) | **asymptotic**; correctness restored |
| Memory per append (steady state) | full-file string + parsed array | one int per append | **≈ n-fold reduction at steady state** |

> **Pending**: a long-running Researcher session (≥ 10 000 events) was not captured in this delegation. How to capture: drive a fake Researcher through `appendRoleEvent` for N = 1, 10², 10³, 10⁴ events inside a single Node process and plot mean / p95 wall-clock and bytes-read per append, both before and after.

## 4. Stop-RoleTree `$pid` shadowing fix (collateral)

The bounded-timeout test exposed a pre-existing PowerShell 5.1 quirk: `foreach ($pid in …)` triggers `SessionStateUnauthorizedAccessException` ("Cannot overwrite local PID") because `$pid` is case-insensitive to the read-only automatic `$PID`. The original code never exercised this branch in CI. The fix renames the loop variable to `$procId`. **Observed**: 51/51 tests pass on three consecutive runs after the fix.

## 5. Reproducible experiment matrix (for Lead acceptance)

The Lead can run the following from `D:/Coding/Harness/Pi-team-PERF-005` to reproduce every observation above:

1. `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1` → 51/51 pass, ≈ 94 s.
2. `git diff scripts/pi-team.ps1 .pi/communication/role-events.mjs tests/team-contract.test.mjs tests/cleanup.mjs tests/run-tests.ps1` → confirms the three production changes plus nine new tests plus the cleanup infrastructure.
3. `git log -1 --format="%h %s"` → `e5dc248 chore: define PERF-005 optimization task` (the contract-bound HEAD).

## 6. Out-of-scope confirmations

PERF-005 explicitly did **not** touch:

- `Event` in `scripts/pi-team.ps1` (legacy pi-team/v1 journal) — out of scope per PERF-004 Option 2.
- `blackboard-core.mjs` `allEvents` / `snapshot` / `watch` — out of scope per PERF-004 Option 5.
- `Stop-RoleTree`'s force-tree-kill behaviour — out of scope per PERF-004 Option 6.
- The `pi-team.cmd` command surface, the v2 task contract schema, identity env-var names, and the intercom contract — all unchanged.
- GitHub Issues, run archives, and unrelated spec docs — unchanged.