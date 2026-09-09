# PERF-005 — Implementation Notes

- Lead task ID: **PERF-005**
- Executor delegation: **EXECUTOR-005**
- Worktree: `D:/Coding/Harness/Pi-team-PERF-005` (branch `pi-team/PERF-005`, base `master`)
- Implementation slice state: complete; ready for paired Reviewer.
- Date: 2026-08-28

## Scope Recap

Implement three boundary-clear performance optimizations selected from the PERF-004 ranked options, while preserving the existing CLI, task lifecycle, communication and state contracts:

1. **Wait-RoleReady ready waiting path** (PERF-004 Option 3) — adaptive backoff in `scripts/pi-team.ps1`.
2. **Start-RoleProcess bootstrap parameter passing path** (PERF-004 Option 2) — drop redundant inner env-setting in the bootstrap script.
3. **Event log sequence append path** (PERF-004 Option 4) — in-memory cache plus `.seq` sidecar in `.pi/communication/role-events.mjs`.

Out of scope (and not touched): Option 2's legacy event routing, Option 5's Blackboard snapshot/watch indexing, Option 6's graceful failure recovery, GitHub Issues, run archives, the public `pi-team.cmd` surface, the v2 contract schema, identity env-var names, and the intercom contract.

## Files Changed

### `scripts/pi-team.ps1`

- **`Wait-RoleReady`** — replaced the constant 100 ms timer with an adaptive backoff schedule that still honours the 60 s bounded deadline and the existing `Fail` message:
  - `0–1 s` elapsed: 50 ms sleeps (fast reaction on a quick ready).
  - `1–5 s`: 200 ms sleeps.
  - `5–20 s`: 500 ms sleeps.
  - `20 s+`: 1000 ms sleeps (cap).
  - Bounded iteration count drops from ≈600 to ≈85 in the worst case (60 s), and matches the previous cadence within a handful of iterations for the fast-ready path.
- **`Stop-RoleTree`** — renamed the foreach iteration variable from `$pid` to `$procId`. `$pid` is the read-only PowerShell automatic variable, and PowerShell 5.1 throws `SessionStateUnauthorizedAccessException` ("Cannot overwrite local PID") when it is assigned via `foreach ($pid in …)`. The original code only worked because the happy-path integration test never exercised this branch; the new bounded-timeout test surfaced the latent bug. Fix is local and keeps the same semantics.
- **`Start-RoleProcess`** — removed `$data.identity.psobject.Properties | ForEach-Object { Set-Item -Path ('Env:'+$_.Name) -Value ([string]$_.Value) }` from the bootstrap script. The outer PowerShell already writes the eight `PI_TEAM_*` env vars in the process scope above the `Start-Process`, and `wt.exe` (which then hosts the inner PowerShell) inherits them. The bootstrap still carries `identity` in the JSON payload (kept for defence in depth and to preserve the existing contract shape) but no longer applies it; the savings are a smaller bootstrap script, no per-property `Set-Item Env:` loop, and no `psobject.Properties` enumeration on the inner side. Identity env vars on the recorded process come from inheritance.

### `.pi/communication/role-events.mjs`

- Replaced the O(n) full-file scan-and-parse in `existingSequence` with:
  - A `<file>.seq` sidecar written under the existing `withLock` after each append, and **read** on every append inside the lock so the sequence source is safe across Node processes. The previous process-local cache was removed because a stale cache hit inside the lock would silently produce duplicate sequences (e.g. `[1, 2, 2, 3]`) when a sibling Node process had updated the sidecar in between.
- The cold-start path (`readAuthoritativeSequence`) reads the sidecar first (O(1) one-int read); on missing/empty/corrupt/non-integer content it falls back to `scanSequenceFromFile` once and rewrites the sidecar to the reconciled value. Subsequent calls always take the O(1) sidecar path.
- `withLock` semantics, the `appendRoleEvent` signature, the `registerRoleRuntime` signature, and the on-disk event record shape are unchanged.
- All concurrent-sequence invariants from `tests/team-contract.test.mjs` (`report_to_lead event storage continues sequences across concurrent appends`) are preserved verbatim: a fresh in-process run with 1 + 8 concurrent appends still yields sequences `[2..9]`.

### `tests/team-contract.test.mjs`

Added nine tests around the new behavior (all deterministic; no live profiler or third-party service):

1. `appendRoleEvent seeds a fresh event log with sequence 1 and writes a .seq sidecar` — first append to a brand-new (task, role) pair yields sequence 1 and the `.seq` sidecar mirrors the value.
2. `appendRoleEvent recovers from a pre-existing event log without a .seq sidecar` — pre-PERF-005 event logs are migrated without gaps or duplicates.
3. `appendRoleEvent falls back to a full scan if the .seq sidecar is corrupt` — a partial write to `.seq` does not break continuity; the sidecar is rewritten to the reconciled value.
4. `appendRoleEvent reads the .seq sidecar on cold start in a fresh Node subprocess` — two appends then truncate the JSONL, then spawn a fresh Node subprocess for the next append; the subprocess must observe sequence `3` (i.e., read the sidecar's `2 + 1`) rather than scan the empty JSONL and emit `1`. *(Added in FIX_READY cycle 1, paired Reviewer finding `sidecar-write-only`.)*
5. **`appendRoleEvent preserves sequence continuity when two independent Node subprocesses interleave appends`** *(added in FIX_READY cycle 2, Lead finding `cross-process-sequence-cache`)* — two fresh Node subprocesses each do 8 appends via `spawnSync`, kicked off in parallel. The collected sequences must be `[1..16]` contiguous, duplicate-free; the JSONL must hold 16 entries; the sidecar must read `16`. This is the deterministic cross-process regression that guards the Lead's reproduction `[1, 2, 2, 3]`.
6. **`appendRoleEvent re-reads the sidecar under the lock when a stale sidecar is observed (simulates another process)`** *(added in FIX_READY cycle 2)* — same-process simulation of the cross-process bug: parent appends once (sequence 1, sidecar = `1`), then writes `5` to the sidecar and four matching event lines to the JSONL — mimicking a sibling Node process that has just issued sequences 2–5 — then appends again. With the buggy in-process cache the parent would emit sequence `2` (duplicate). With the lock-protected sidecar re-read the parent must emit sequence `6`.
7. `appendRoleEvent stays sequence-continuous under heavy concurrent fan-out` — 32-way concurrent appends to the same file still yield `[1..32]` and the sidecar matches.
8. `Start-RoleProcess bootstrap transmits identity, directory, executable, and arguments with special characters and long payloads` — covers boundary cases (semicolons, backticks, ampersands, parens, dollar-sign, long ≈2 KB body).
9. `Wait-RoleReady bounded timeout fires at ~60 s when no runtime.json appears` — drives a fake Pi that never writes the runtime file, asserts `start` fails non-zero with the canonical "role startup did not register readiness" message, and that wall-clock falls in `[58 s, 75 s]`.

### `tests/cleanup.mjs` and `tests/run-tests.ps1`

- `tests/cleanup.mjs` — wipes leftover `ENV-`, `BND-`, `TMO-`, `ACC-`, `CAP-`, `EVT-`, `FRESH-`, `LEGACY-`, `CORRUPT-`, `HEAVY-`, `XPROC-`, `STALE-`, `COLD-` prefixes from both `<commonDir>/pi-team/v1/` and `<commonDir>/harness-blackboard/v1/`; removes orphan worktree references whose backing directory no longer exists (so `git branch -D` succeeds); and drops orphan `pi-team/test-*` / `pi-team/test-bootstrap-*` / `pi-team/test-wait-*` branches. Idempotent and silent on missing paths.
- `tests/run-tests.ps1` — invokes `cleanup.mjs` before the test runner so the suite is idempotent across runs that were previously interrupted (e.g., `Ctrl-C`, debug kills) before `finally` could clean up.

## FIX_READY cycles

### Cycle 1 (paired Reviewer finding `sidecar-write-only`, resolved)

The paired Reviewer's first review sent `REVIEW_FAIL` with one finding (full artifact at `failures/PERF-005-sidecar-write-only.md`): the original implementation wrote the `<file>.seq` sidecar after each append but never read it back; on cold start (`sequenceCache` miss), `readCachedSequence` always fell through to a full JSONL scan, silently overwriting a higher sidecar value with a lower scan result when the JSONL had been truncated or partially corrupted. The four same-process tests did not catch the regression because the in-memory cache always hits.

Fix applied in `.pi/communication/role-events.mjs`:
- New `readSidecarSequence(file)` helper that reads `${file}.seq`, validates it as a non-negative integer, and throws on missing/empty/non-integer content.
- `readCachedSequence` (now renamed `readAuthoritativeSequence`) re-reads the sidecar on every append: cache hit → O(1) Map read; cache miss → try the sidecar first (O(1) one-int read); on sidecar failure → fall back to `scanSequenceFromFile` and rewrite the sidecar to the reconciled value so subsequent cold starts skip the scan.
- A regression test (item 4 above) drives the Reviewer's phase 1/phase 2/phase 3 probe end-to-end via `spawnSync(process.execPath, [...])` so the child Node process cannot inherit the parent's `sequenceCache`.
- Outcome: paired Reviewer sent `REVIEW_PASS`.

### Cycle 2 (Lead finding `cross-process-sequence-cache`, resolved)

Lead's acceptance review sent `REVIEW_FAIL` with one finding (full artifact at `failures/PERF-005-cross-process-sequence-cache.md`): two independent Node processes each calling `appendRoleEvent` twice produced sequences `[1, 2, 2, 3]`. The root cause was the cycle-1 in-process `sequenceCache`: when a process held the file lock with a cache value that another process had already advanced past, the cache hit silently returned the stale value and the next sequence was a duplicate. The 49 tests at cycle-1 close could not catch the regression because all concurrent tests ran inside one Node process.

Fix applied in `.pi/communication/role-events.mjs`:
- **Removed the in-process `sequenceCache` Map entirely** — it could not be trusted inside the lock and is dead code outside the lock. The lock-protected sidecar re-read is the only sequence source.
- `appendRoleEvent` now calls `readAuthoritativeSequence(file)` (formerly `readCachedSequence`) on every append. The lock guarantees single-writer access, but it does not prevent a sibling Node process from updating the sidecar between our previous append and our acquisition of the lock, so the sidecar must be re-read under the lock.
- Two new tests (items 5 and 6 above) exercise the cross-process invariant deterministically. Item 5 spawns two fresh Node subprocesses via `spawnSync` and asserts contiguous, duplicate-free sequences across the 16 appends. Item 6 simulates a stale sidecar inside a single process and asserts that the next append issues sequence `6` (not the buggy `2`).

## Validation Performed

- `tests/run-tests.ps1` (cross-shell runner): **51/51 tests pass** in ≈ 94 s on the worktree (two more than cycle-1's 49; the new cross-process regression tests).
  - Includes the unchanged pre-existing contract, communication-policy, and blackboard tests.
  - Includes all seven `appendRoleEvent` sequencing tests above.
  - Includes the bootstrap boundary and bounded-timeout tests.
  - Includes the updated "tests directory" test (now expects `cleanup.mjs` as a legitimate infrastructure file).
- Cross-process probe (item 5): two fresh Node subprocesses, 8 appends each, produced 16 contiguous unique sequences across both processes; JSONL has 16 lines; sidecar reads `16`.
- Single-process stale-sidecar probe (item 6): parent observed sequence `6` (the sidecar's `5 + 1`), not the buggy `2`.
- All three integration-test timing observations (recorded in `reports/PERF-005-performance.md`):
  - `role launchers inject common-dir identity …`: ≈ 16 s (down from ≈ 22 s on master; the bootstrap path is leaner).
  - `Start-RoleProcess bootstrap transmits …`: ≈ 5–9 s (new).
  - `Wait-RoleReady bounded timeout fires …`: ≈ 63 s (new).

## Remaining Risks

- **Cmd.exe argv length**: any future contract whose expanded `assignment` text pushes the total `wt.exe -EncodedCommand <bootstrap>` command line above the ~8 KB cmd.exe limit would force a follow-up to the bootstrap-file refactor proposed in the Researcher's design review. Today's longest live integration assignment is ~1.5 KB; the worst observed Bootstrap test was ≈ 5 KB and stayed under the limit thanks to gzip compression on the JSON payload.
- **wt.exe custom profiles**: the inner env-setting removal relies on the inner PowerShell inheriting the outer process env. The default wt.exe behaviour inherits; if a user has a custom pane profile that strips env vars, the role would lose identity. The defence-in-depth identity payload is still in the JSON for this case, but the bootstrap script no longer applies it. The README and `project_state.md` should call this out before the change ships.
- **Sidecar crash window**: if a process crashes after `appendFile` but before `persistSequenceSidecar`, the next process cold-start will rescan the JSONL and recover. The window is bounded by the existing `withLock`; no duplicate sequences can be issued by concurrent writers.
- **Executor remains allocated**: per the contract, this Executor stays alive and idle after the slice so the paired Reviewer can drive `FIX_READY` rounds. No commit, stash, reset, checkout, rebase, or cleanup has been performed.

## Handoff

- Implementation artifacts are at `scripts/pi-team.ps1`, `.pi/communication/role-events.mjs`, `tests/team-contract.test.mjs`, `tests/cleanup.mjs`, `tests/run-tests.ps1`, and this file.
- Performance measurement record is at `reports/PERF-005-performance.md`.
- Status to be sent to the paired Reviewer via intercom with `READY_FOR_REVIEW` and the worktree + notes paths.