# PERF-005 — Sidecar write-only regression in `appendRoleEvent`

- Finding ID: `sidecar-write-only`
- Owner: Reviewer (paired with Executor on PERF-005)
- Status: open; awaiting Executor `FIX_READY` cycle
- Date: 2026-08-28

## Summary

`PERF-005` claims that `.pi/communication/role-events.mjs` uses a `.seq` sidecar so a **fresh Node process** can recover the last issued sequence in **O(1)** without re-parsing the entire JSONL. The implementation writes the sidecar but `readCachedSequence` never reads it. Cold-start still does the original O(n) full scan; the sidecar is dead code in terms of read performance. The performance report (`reports/PERF-005-performance.md` §3 inferred-benefit table) overstates the gain as a result.

## Reproduction (deterministic, three Node processes)

Three small reviewer scripts at the worktree root (`_review_sidecar_phase1.mjs`, `_review_sidecar_phase2.mjs`, `_review_sidecar_phase3_truncate.mjs`) drive the cold-start path. Phase 1 and Phase 2 each run in their own Node process so the in-process `sequenceCache` cannot leak.

1. `node _review_sidecar_phase1.mjs _review_probe_dir`
   - Two appends in process A produce sequences `1` and `2`. Sidecar = `2\n`.
2. `node _review_sidecar_phase3_truncate.mjs _review_probe_dir`
   - Truncates `COLD-001-executor.jsonl` to zero bytes. Sidecar is left at `2\n`.
3. `node _review_sidecar_phase2.mjs _review_probe_dir`
   - One append in process B (fresh). Sidecar still says `2`, JSONL is empty.

Observed output:

```
{"r1Seq":1,"r2Seq":2}
truncated _review_probe_dir/COLD-001-executor.jsonl
{"sequence":1,"sidecar":"1","elapsedMs":2.7478}
```

Process B issued sequence `1` and rewrote the sidecar to `1\n`. The correct cold-start behaviour is sequence `3` (i.e., the sidecar's `2 + 1`). Sequence `2` is silently lost.

## Why the implementation is wrong

`.pi/communication/role-events.mjs`:

```javascript
async function readCachedSequence(file) {
  if (sequenceCache.has(file)) return sequenceCache.get(file);
  const maximum = await scanSequenceFromFile(file);   // always scans
  sequenceCache.set(file, maximum);
  return maximum;
}
```

`readCachedSequence` only consults the in-process `Map`; on a cache miss (which is exactly the fresh-process case) it always falls through to `scanSequenceFromFile`. There is no code path that opens `${file}.seq`. A grep confirms:

```
$ grep -n "\.seq" .pi/communication/role-events.mjs
10: // cold file (no `.seq` sidecar yet) requires a one-time scan.
36: // The `.seq` sidecar lets a fresh process recover the latest sequence
41:   await writeFile(`${file}.seq`, `${sequence}\n`, "utf8");   // write-only
```

The two `.seq` references in the file are: a comment about a sidecar that is missing, and a `writeFile` call that creates it. Nothing reads it back.

## Why existing tests do not catch this

The new regression tests in `tests/team-contract.test.mjs` cover:

- Fresh file → sequence 1, sidecar written. ✓
- Legacy event log (no sidecar) → cold-start scans and reconciles. ✓
- Corrupt sidecar → cold-start scans and reconciles. ✓
- 32-way concurrent append → in-process cache delivers `[1..32]`. ✓

None of these exercises the **sidecar-valid, JSONL-missing-or-stale** case. The corrupt-sidecar test writes `"garbage-not-a-number\n"` and asserts the scan recovers, but it runs inside the same Node process as the prior appends, so the in-process `sequenceCache` already holds the correct value and the sidecar is never consulted. (See the probe above for the explicit verification.)

## Why this matters

1. **The design's primary cold-start optimization is not delivered.** The research design review (`research/PERF-005-design-review.md` §3, headline) and the implementation notes (`implementation_notes/PERF-005.md` §"Files Changed" / ".pi/communication/role-events.mjs") both state that the sidecar enables a fresh process to recover the latest sequence in O(1). The code does not implement that.
2. **The performance report's benefit table overstates the gain.** `reports/PERF-005-performance.md` §3 inferred benefit table:
   > "Per-append sequence lookup (fresh process, sidecar present) | O(n) read + O(n) parse | O(1) sidecar read | asymptotic"
   The "O(1) sidecar read" column is not true on cold start; the actual behaviour is unchanged from master.
3. **Data loss in the documented failure modes.** When the JSONL is corrupted or truncated (a documented failure mode the implementation claims to handle), the valid sidecar is silently overwritten with the lower value from the partial scan. Phase 2 of the probe demonstrates this exact regression: sidecar starts at `2`, JSONL is empty, fresh process issues sequence `1`, sidecar rewritten to `1`, prior sequence `2` lost.

## Expected fix (Exemplar only — Reviewer does not edit production code)

`readCachedSequence` should consult the sidecar before scanning:

```javascript
async function readCachedSequence(file) {
  if (sequenceCache.has(file)) return sequenceCache.get(file);
  // Cold-start: read the .seq sidecar first (O(1) integer).
  // On missing, empty, corrupt, or non-numeric content, fall back to a
  // full scan and rewrite the sidecar to the reconciled value.
  let maximum = 0;
  try {
    const text = await readFile(`${file}.seq`, "utf8");
    const parsed = Number(text.trim());
    if (Number.isInteger(parsed) && parsed >= 0) {
      maximum = parsed;
    } else {
      throw new Error("non-integer sidecar");
    }
  } catch {
    maximum = await scanSequenceFromFile(file);
  }
  sequenceCache.set(file, maximum);
  return maximum;
}
```

After the fix, the probe must observe `sequence: 3, sidecar: "3"` for the cold-start call, and the existing "corrupt sidecar → full scan" test must still pass.

## Required follow-up by Executor

1. Apply the read-sidecar fix above (or an equivalent) to `.pi/communication/role-events.mjs`.
2. Add a regression test that runs in a fresh subprocess (mirroring the probe) and asserts that a valid sidecar is read instead of scanning the JSONL. The test must cover the sidecar-valid + JSONL-missing case that the current suite misses.
3. Update `implementation_notes/PERF-005.md` and `reports/PERF-005-performance.md` to either reconcile the documentation with the implementation, or keep them aligned with the corrected code.
4. Re-run `tests/run-tests.ps1` from the worktree root and report the new 48+/48+ pass count and the cold-start probe result.

## Evidence files

- `.pi/communication/role-events.mjs` — the read-sidecar gap (line 23–29: `readCachedSequence`).
- `tests/team-contract.test.mjs` — the new tests, none of which exercise the sidecar-valid + JSONL-missing case.
- `reports/PERF-005-performance.md` §3 — the inferred-benefit table that overstates the gain.
- `_review_sidecar_phase1.mjs`, `_review_sidecar_phase2.mjs`, `_review_sidecar_phase3_truncate.mjs` — reviewer evidence scripts at the worktree root.
