# PERF-005 — Reviewer slice (ready_for_acceptance, cycle 2)

- Lead task ID: **PERF-005**
- Reviewer delegation: **REVIEW-005**
- Worktree: `D:/Coding/Harness/Pi-team-PERF-005` (branch `pi-team/PERF-005`, base `master`)
- Reviewer state: **ready_for_acceptance**
- Reviewer artefact: this file (cycle 2 update)
- Failure artefacts:
  - cycle 1: `failures/PERF-005-sidecar-write-only.md` (paired Reviewer finding, resolved)
  - cycle 2: `failures/PERF-005-cross-process-sequence-cache.md` (Lead finding, resolved)
- Reviewer evidence scripts (worktree root, audit trail): `_review_sidecar_phase1.mjs`, `_review_sidecar_phase2.mjs`, `_review_sidecar_phase3_truncate.mjs`, `_review_race_probe.mjs`
- Date: 2026-08-29

## Final verdict

**`REVIEW_PASS`** — both cycle-1 (paired Reviewer `sidecar-write-only`) and cycle-2 (Lead `cross-process-sequence-cache`) findings are resolved. The lock-protected sidecar is now the **only** sequence source; no in-process cache can drift from the file state. 51/51 tests pass on Reviewer re-run. Implementation notes and performance report are reconciled.

## Cycle history

| Cycle | Finding | Source | Resolution |
| --- | --- | --- | --- |
| 1 | `sidecar-write-only` | paired Reviewer | `readSidecarSequence` + `readCachedSequence` reads sidecar on cold start |
| 2 | `cross-process-sequence-cache` | Lead | Removed in-process `sequenceCache` Map entirely; `readAuthoritativeSequence` re-reads sidecar inside the lock on every append |

The cycle-1 fix shipped a per-process `sequenceCache` that was consulted on a cache hit. That cache could be stale when a sibling Node process had advanced the sidecar between this process's previous append and its next acquisition of the lock — Lead's reproduction `[1, 2, 2, 3]`. The cycle-2 fix removes the cache entirely so the lock-protected sidecar re-read is the only sequence source. The cache hit path was O(1); the new always-read path is also O(1) per append (one small file read + one small file write under the lock).

## What changed since cycle 1

| Area | Change | Verdict |
| --- | --- | --- |
| `.pi/communication/role-events.mjs` | In-process `sequenceCache` Map removed entirely. | ✅ |
| `.pi/communication/role-events.mjs` `readCachedSequence` | Renamed to `readAuthoritativeSequence`. Always reads the sidecar (under the lock on every call); on missing/empty/corrupt/non-integer content falls back to `scanSequenceFromFile` and rewrites the sidecar to the reconciled value. | ✅ |
| `.pi/communication/role-events.mjs` `appendRoleEvent` | Sequence source re-read inside `withLock` on every call. Sidecar written after `appendFile` (best-effort `.catch(() => undefined)`). | ✅ |
| `.pi/communication/role-events.mjs` `registerRoleRuntime` | Unchanged. | ✅ |
| `tests/team-contract.test.mjs` | Two new regression tests: (1) `appendRoleEvent preserves sequence continuity when two independent Node subprocesses interleave appends` (16 appends across two `spawnSync` children must yield `[1..16]`); (2) `appendRoleEvent re-reads the sidecar under the lock when a stale sidecar is observed (simulates another process)` (parent writes `5` to sidecar + 4 event lines, then appends — must emit sequence `6`, not the buggy `2`). | ✅ |
| `tests/cleanup.mjs` | Adds new prefixes `XPROC-`, `STALE-`, `COLD-` to the wipe list so the cycle-2 test fixtures are cleaned up before the next run. | ✅ |
| `implementation_notes/PERF-005.md` | New `FIX_READY cycle 2` section explicitly explains why the in-process cache was removed; new test items 5 and 6 added; description updated to "read on every append inside the lock". | ✅ |
| `reports/PERF-005-performance.md` | New "Post-cycle-2 note" explaining the cycle-2 bug and fix; two new observation rows (cross-process and stale-sidecar); inferred-benefit table now has a `cross-process` row with `correctness restored`. | ✅ |

## Independent re-verification (cycle 2)

### Cross-process race probe

Reviewer script `_review_race_probe.mjs` (worktree root) spawns two fresh Node subprocesses; each does two appends; B is kicked off after a 200 ms delay so A's first append commits first. Observed:

```
A stdout: {"label":"A","seqs":[1,2]}
B stdout: {"label":"B","seqs":[3,4]}
all sequences: [ 1, 2, 3, 4 ]
expected:      [ 1, 2, 3, 4 ]
contiguous?   true | duplicates? false
jsonl lines:  4 | sidecar: 4
TEST VERDICT: PASS (sequences contiguous across two subprocesses)
```

This is the same shape as Lead's reproduction (`[1, 2, 2, 3]` pre-fix → `[1, 2, 3, 4]` post-fix) but for a smaller fan-out. The cycle-2 test in `tests/team-contract.test.mjs` covers the larger 16-append fan-out.

### Cold-start probe (regression check for cycle 1)

Three-process probe re-run:

```
Phase 1 (parent): r1Seq=1, r2Seq=2 → sidecar="2\n"
Phase 2 (parent): truncate JSONL → JSONL empty, sidecar still "2\n"
Phase 3 (child subprocess): sequence=3, sidecar="3", elapsedMs=3.2123
```

Cycle-1 fix still works: the cold-start path reads the sidecar under the lock and continues from `2 + 1 = 3`.

### Full test suite

```
$ node tests/cleanup.mjs
$ node --test tests/team-contract.test.mjs tests/communication-policy.test.mjs tests/blackboard.test.mjs
…
✔ report_to_lead event storage continues sequences across concurrent appends (243.2106ms)
✔ appendRoleEvent seeds a fresh event log with sequence 1 and writes a .seq sidecar (12.2746ms)
✔ appendRoleEvent recovers from a pre-existing event log without a .seq sidecar (8.3687ms)
✔ appendRoleEvent falls back to a full scan if the .seq sidecar is corrupt (42.6889ms)
✔ appendRoleEvent reads the .seq sidecar on cold start in a fresh Node subprocess (70.019ms)
✔ appendRoleEvent preserves sequence continuity when two independent Node subprocesses interleave appends (115.0101ms)
✔ appendRoleEvent re-reads the sidecar under the lock when a stale sidecar is observed (simulates another process) (3.9145ms)
✔ appendRoleEvent stays sequence-continuous under heavy concurrent fan-out (1040.3917ms)
✔ Start-RoleProcess bootstrap transmits identity, directory, executable, and arguments with special characters and long payloads (...)
✔ Wait-RoleReady bounded timeout fires at ~60 s when no runtime.json appears (...)
…
ℹ tests 51
ℹ pass 51
ℹ fail 0
ℹ duration_ms 89042.7046
```

51/51 pass in 89.0 s. Two more than cycle 1's 49 — the two new cross-process regression tests.

### Diff scope (cumulative across cycles)

```
.pi/communication/role-events.mjs |  77 +++++-
scripts/pi-team.ps1               |  30 ++-
tests/run-tests.ps1               |   4 +
tests/team-contract.test.mjs      | 485 +++++++++++++++++++++++++++++++++++++-
4 files changed, 577 insertions(+), 19 deletions(-)
```

All four files are in the Lead-assigned in-scope list. No new untracked files outside `tests/cleanup.mjs`, the four Executor artefacts, the Lead/Reviewer failure artifacts, the three reviewer evidence scripts, the cross-process probe script, and the four reports/notes.

## Out-of-scope confirmations (unchanged from cycle 1)

The Executor only modified files inside the Lead-assigned in-scope list. No changes to:

- `pi-team.cmd` command surface
- v2 task contract schema
- Identity env-var names (`PI_TEAM_*`, `PI_INTERCOM_STABLE_ID`)
- Intercom contract (`.pi/communication/runtime-policy.mjs`, `persistent-store.mjs`)
- `blackboard-core.mjs`
- The legacy `Event` function in `scripts/pi-team.ps1` (PERF-004 Option 2)
- GitHub Issues, run archives, or unrelated spec docs
- PERF-004 Option 5 (Blackboard snapshot/watch indexing) and Option 6 (graceful failure recovery)

## Decision

`REVIEW_PASS` — ready for Lead acceptance.

The three Lead-assigned optimizations (Wait-RoleReady, Start-RoleProcess bootstrap, event sequence append) are all correctly implemented, tested, and documented. The cycle-1 and cycle-2 findings are both resolved. Performance measurements distinguish observed/inferred/pending per the Lead requirement.

## Status

- Reviewer slice: `ready_for_acceptance`
- Blackboard: `ready_for_acceptance`
- Paired Executor: notified via `intercom send` with `REVIEW_PASS`.
- Reviewer remains allocated and idle until Lead acceptance and reclamation.
- No commit, stash, reset, checkout, rebase, or cleanup performed by Reviewer.
