# PERF-005 review finding — stale sequence cache across Node processes

## Status

`REVIEW_FAIL` follow-up finding. PERF-005 is not ready for Lead acceptance until
the same-task Executor fixes this or the contract is explicitly narrowed by
Lead.

## Reproduction

Two independent Node processes each call `appendRoleEvent` twice on the same
`CROSS-001-executor.jsonl`, with the second process starting after the first
process has written its first event. The current branch produced:

```json
{"outputs":["first=1\nsecond=2","first=2\nsecond=3"],"seqs":[1,2,2,3]}
```

The duplicated `2` is a real cross-process sequence collision.

## Root cause

`appendRoleEvent` holds the file lock, but `readCachedSequence(file)` returns
the per-process `sequenceCache` value on a cache hit without re-reading the
sidecar or reconciling the current file state. After another process appends,
the first process still holds its older maximum and can issue a duplicate.
The existing 32-way test uses concurrent promises in one Node process, so all
calls share one cache and does not cover this boundary.

## Required correction

Preserve the lock and the O(1) goal while making the sequence source safe for
multiple processes. Add a deterministic cross-process regression test that
interleaves two fresh Node processes and asserts contiguous, duplicate-free
sequences. Do not claim the sidecar optimization is concurrency-safe until
that test passes.
