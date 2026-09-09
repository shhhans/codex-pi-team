# COMPRESSION-001 — Resource-limit stop never writes a checkpoint

**Task:** COMPRESSION-001
**Finding:** `checkpoint-never-written-on-resource-cap-stop`
**Severity:** Critical
**Status:** Open (REVIEW_FAIL)

## Summary

When a role hits a resource limit (per-segment tool-call cap or compaction
retry cap), the compression extension returns `terminate: true` and claims
"checkpoint written", but the checkpoint is **never actually written** and the
task-state stop record is **never persisted**.

## Root cause

`.pi/communication/extensions/compression.ts`:

1. `triggerLimitShutdown()` (lines ~162-171) sets `state.stopped = true` and
   `state.stopReason` **before** shutdown:
   ```ts
   function triggerLimitShutdown(ctx, state, code, message) {
     if (state.stopped) return;
     state.stopped = true;
     state.stopReason = { code, message, triggered_by: "compression-extension" };
     ...
   }
   ```
2. The `session_shutdown` handler (line ~263) starts with:
   ```ts
   pi.on("session_shutdown", async (_event, _ctx) => {
     const state = runtime;
     if (!state || state.stopped || !state.stopReason) return;  // <-- returns
     state.stopped = true;
     try { ... writeCheckpoint ... persistTaskState ... } catch ...
   });
   ```
   Because `state.stopped` is already `true`, the handler returns immediately
   and the `writeCheckpoint` + `persistTaskState` calls (the **only** calls to
   those functions, confirmed by `grep`) are unreachable on any limit stop.
3. The `tool_call` handler (line ~199) returns
   `{ block: true, reason: "...checkpoint written, role is stopping", terminate: true }`
   — the reason string is a **false claim**: no checkpoint was written.

## Reproduction

Behavioral probe driving the extension with a fake Pi runtime
(`node --experimental-strip-types`, fake `ExtensionAPI`), with
`max_tool_calls_per_segment: 2`:

1. `session_start` loads the policy.
2. Fire `tool_call` 3 times. The 3rd returns
   `{block:true, reason:"...checkpoint written...", terminate:true}`.
3. Fire `session_shutdown`.
4. Observe `state_root/checkpoints` does **not** exist, and
   `state_root/COMPRESSION-001.json` has no `last_checkpoint_path`,
   `last_stop_reason`, `last_frozen_policy`, or `last_stats`.

Captured as `tests/automatic-compression.test.mjs` → `C-004 behavior 3:
resource cap stops the role and writes a credential-free checkpoint +
task-state stop record` (FAILING).

## Expected vs observed

- **Expected (C-002):** reaching the limit stops the role AND writes a
  versioned, credential-free checkpoint; task state records frozen policy,
  stats, checkpoint path, and stop reason.
- **Observed:** role stops (`terminate: true`) but no checkpoint file and no
  task-state stop record are produced.

## Criteria violated

- **C-002** (executor): "达到上限会停止当前角色并生成不含凭据的版本化
  checkpoint，task state 保存冻结策略、统计、路径和停止原因" — checkpoint and
  task-state persistence never happen.
- **C-004** (reviewer): "资源上限可安全停止" and "checkpoint 不泄露凭据" cannot
  be satisfied because no checkpoint is ever generated.

## Fix direction (executor)

`session_shutdown` must write the checkpoint when a resource-limit stop
occurred. Options: (a) do not set `state.stopped` inside `triggerLimitShutdown`
and let `session_shutdown` own the final `stopped` transition, or (b) change
the `session_shutdown` guard to require `state.stopReason` without requiring
`!state.stopped`. Also correct the `tool_call` reason string so it does not
claim a checkpoint was written when the write is deferred to shutdown.

## Evidence

- `tests/automatic-compression.test.mjs` (behavior 3, failing).
- Behavioral probe output: `checkpoints dir exists: false`,
  `last_checkpoint_path in state: false`, `last_stop_reason in state: false`.
