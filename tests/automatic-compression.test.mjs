// COMPRESSION-001 — Reviewer behavioral tests for done criterion C-004.
//
// C-004 requires tests that PROVE, against the live extension, that:
//   1. threshold compression triggers only once,
//   2. length-error recovery retries at most once,
//   3. a resource cap stops the role safely AND writes a credential-free
//      checkpoint plus a task-state stop record,
//   4. the checkpoint never leaks credentials,
//   5. plain `resume` does not silently reuse a constrained session.
//
// The extension (`compression.ts`) is a TypeScript Pi extension whose event
// handlers can only run against a live ExtensionAPI. We drive those handlers
// directly with a fake Pi runtime using Node's native type-stripping
// (`node --experimental-strip-types`), which the `tests/run-tests.ps1`
// harness invokes via `node --test`. This is the fake-Pi behavioral coverage
// the in_scope "targeted/fake-Pi 测试" clause calls for.
//
// These tests assert the REQUIRED behavior. If a behavior is not implemented,
// the corresponding test fails, capturing the defect as regression coverage.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd();
const EXTENSION = join(REPO, ".pi/communication/extensions/compression.ts");
const TASK_ID = "COMPRESSION-001";

// ---------------------------------------------------------------------------
// Fake Pi runtime
// ---------------------------------------------------------------------------

function makeEnv(stateRoot, worktree, overrides = {}) {
  mkdirSync(join(worktree, ".pi"), { recursive: true });
  writeFileSync(join(worktree, ".pi", "team-runtime.json"), JSON.stringify({
    version: 1,
    compression: {
      threshold_percent: 0.5,
      max_tool_calls_per_segment: overrides.maxToolCalls ?? 2,
      max_compact_retries: overrides.maxRetries ?? 1,
      output_token_limit: 65536,
      role_overrides: {},
    },
  }, null, 2), "utf8");
  mkdirSync(join(stateRoot, "contracts"), { recursive: true });
  writeFileSync(join(stateRoot, `${TASK_ID}.json`), JSON.stringify({
    task_id: TASK_ID,
    frozen_provider_model: { provider: "minimax-cn", model: "MiniMax-M3" },
    contract_version: 2,
    contract_path: "contracts/COMPRESSION-001.md",
  }, null, 2), "utf8");
  writeFileSync(join(stateRoot, "contracts", "COMPRESSION-001.md"), "# contract\n", "utf8");
  const previous = { ...process.env };
  process.env.PI_TEAM_ROLE = overrides.role ?? "executor";
  process.env.PI_TEAM_TASK_ID = TASK_ID;
  process.env.PI_TEAM_AGENT_ID = "agent-1";
  process.env.PI_TEAM_WORKTREE = worktree;
  process.env.PI_TEAM_STATE_ROOT = stateRoot;
  return previous;
}

function restoreEnv(previous) {
  process.env = previous;
}

// Relative specifier with a unique query forces a fresh module evaluation so
// the module-level `process.env` capture is not cached across tests. The
// relative form works under Node's Windows ESM loader with type stripping.
function freshExtension() {
  // Relative to this test file (tests/automatic-compression.test.mjs).
  const rel = "../.pi/communication/extensions/compression.ts";
  return import(`${rel}?fresh=${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test("C-004 behavior 1: threshold compression triggers compact at most once per crossing and honors the retry budget", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "c004b1-sr-"));
  const worktree = mkdtempSync(join(tmpdir(), "c004b1-wt-"));
  const prev = makeEnv(stateRoot, worktree);
  try {
    const handlers = {};
    const compactCalls = [];
    const pi = { on: (e, h) => { handlers[e] = h; } };
    const ctx = {
      hasUI: false,
      ui: { notify() {} },
      getContextUsage: () => ({ tokens: 150000, contextWindow: 200000, percent: 75 }),
      compact: (o) => compactCalls.push(o),
    };
    const { default: extension } = await freshExtension();
    extension(pi);
    await handlers.session_start({}, ctx);

    // A real Pi ContextUsage.percent is in the range 0..100. A 10% context
    // must remain below the 50% policy threshold.
    ctx.getContextUsage = () => ({ tokens: 20000, contextWindow: 200000, percent: 10 });
    await handlers.agent_settled({}, ctx);
    assert.equal(compactCalls.length, 0, "10% usage must not trigger compaction");

    // First settled agent run above threshold -> exactly one compact.
    ctx.getContextUsage = () => ({ tokens: 150000, contextWindow: 200000, percent: 75 });
    await handlers.agent_settled({}, ctx);
    assert.equal(compactCalls.length, 1, "threshold crossing must trigger exactly one compact");
    // Fire the before/after compact events as Pi would after a successful compact.
    await handlers.session_before_compact({}, ctx);
    await handlers.session_compact({}, ctx);
    // A second settled run at the same usage would re-cross the threshold only if
    // usage actually stayed high after compaction; the retry-budget guard must
    // not have silently counted the first attempt twice.
    assert.equal(compactCalls.length, 1, "a single settled run must not emit multiple compact calls");
  } finally {
    restoreEnv(prev);
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("C-004 behavior 2: length-error recovery retries at most once, then cancels", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "c004b2-sr-"));
  const worktree = mkdtempSync(join(tmpdir(), "c004b2-wt-"));
  const prev = makeEnv(stateRoot, worktree, { maxRetries: 1 });
  try {
    const handlers = {};
    const compactCalls = [];
    const pi = { on: (e, h) => { handlers[e] = h; } };
    const ctx = {
      hasUI: false,
      ui: { notify() {} },
      getContextUsage: () => ({ tokens: 150000, contextWindow: 200000, percent: 75 }),
      compact: (o) => compactCalls.push(o),
    };
    const { default: extension } = await freshExtension();
    extension(pi);
    await handlers.session_start({}, ctx);

    // Initial attempt: allowed.
    await handlers.agent_settled({}, ctx);
    assert.equal(compactCalls.length, 1, "initial threshold compact must be triggered");
    const first = await handlers.session_before_compact({}, ctx);
    assert.ok(!first || !first.cancel, "initial compact attempt must be allowed");
    // Compact fails (no session_compact; completed stays 0).
    // The retry budget is exhausted: the next before_compact must refuse
    // further retries ({cancel:true} or the role is stopped), never an
    // unbounded retry loop, and compact must not be re-triggered past the
    // initial + one retry.
    await handlers.agent_settled({}, ctx);
    const second = await handlers.session_before_compact({}, ctx);
    assert.ok(second && second.cancel === true, "a retry beyond the cap must be cancelled (at most one retry)");
    await handlers.agent_settled({}, ctx);
    assert.ok(compactCalls.length <= 2, "compact must not be re-triggered beyond initial + one retry");
  } finally {
    restoreEnv(prev);
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("C-004 behavior 3: resource cap stops the role and writes a credential-free checkpoint + task-state stop record", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "c004b3-sr-"));
  const worktree = mkdtempSync(join(tmpdir(), "c004b3-wt-"));
  const prev = makeEnv(stateRoot, worktree, { maxToolCalls: 2 });
  try {
    const handlers = {};
    const pi = { on: (e, h) => { handlers[e] = h; } };
    const ctx = {
      hasUI: false,
      ui: { notify() {} },
      getContextUsage: () => ({ tokens: 150000, contextWindow: 200000, percent: 75 }),
      compact() {},
    };
    const { default: extension } = await freshExtension();
    extension(pi);
    await handlers.session_start({}, ctx);

    let capResult;
    for (let i = 1; i <= 3; i++) {
      const r = await handlers.tool_call({}, ctx);
      if (r && r.terminate) capResult = r;
    }
    // The cap must stop the role with terminate.
    assert.ok(capResult && capResult.terminate === true, "tool-call cap must stop the role (terminate)");

    // Pi then fires session_shutdown.
    await handlers.session_shutdown({}, ctx);

    // A checkpoint must have been written under state_root/checkpoints.
    const cpDir = join(stateRoot, "checkpoints");
    assert.equal(existsSync(cpDir), true, "resource-cap stop must write a checkpoint under checkpoints/");
    const state = JSON.parse(readFileSync(join(stateRoot, `${TASK_ID}.json`), "utf8"));
    assert.ok(state.last_checkpoint_path, "task state must record last_checkpoint_path");
    assert.ok(state.last_stop_reason, "task state must record last_stop_reason");
    assert.equal(state.last_stop_reason.code, "tool_call_segment_limit", "stop reason must identify the cap");

    // The written checkpoint must carry frozen policy/stats/stop reason and
    // must never contain credentials or host paths.
    const cpPath = state.last_checkpoint_path;
    const doc = JSON.parse(readFileSync(cpPath, "utf8"));
    assert.equal(doc.frozen_policy.max_tool_calls_per_segment, 2);
    assert.equal(doc.stop_reason.code, "tool_call_segment_limit");
    const json = JSON.stringify(doc);
    assert.doesNotMatch(json, /sk-[A-Za-z0-9]{6,}/, "checkpoint must not leak API keys");
    assert.doesNotMatch(json, /api[_-]?key/i, "checkpoint must not contain api_key");
    assert.doesNotMatch(json, /AIza[0-9A-Za-z_-]{30,}/, "checkpoint must not leak Google keys");
  } finally {
    restoreEnv(prev);
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("configured default with no tool-call cap does not stop after 40 calls", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "c004b6-sr-"));
  const worktree = mkdtempSync(join(tmpdir(), "c004b6-wt-"));
  const prev = makeEnv(stateRoot, worktree, { maxToolCalls: 0 });
  try {
    const handlers = {};
    const pi = { on: (e, h) => { handlers[e] = h; } };
    const ctx = { hasUI: false, ui: { notify() {} } };
    const { default: extension } = await freshExtension();
    extension(pi);
    await handlers.session_start({}, ctx);

    for (let i = 0; i < 41; i++) {
      const result = await handlers.tool_call({}, ctx);
      assert.equal(result, undefined, `disabled cap must not terminate call ${i + 1}`);
    }
    assert.equal(existsSync(join(stateRoot, "checkpoints")), false);
  } finally {
    restoreEnv(prev);
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("automatic compaction does not start concurrently while the prior request is in flight", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "c004b7-sr-"));
  const worktree = mkdtempSync(join(tmpdir(), "c004b7-wt-"));
  const prev = makeEnv(stateRoot, worktree, { maxToolCalls: 0 });
  try {
    const handlers = {};
    const compactCalls = [];
    const pi = { on: (e, h) => { handlers[e] = h; } };
    const ctx = {
      hasUI: false,
      ui: { notify() {} },
      getContextUsage: () => ({ tokens: 150000, contextWindow: 200000, percent: 75 }),
      compact: (options) => compactCalls.push(options),
    };
    const { default: extension } = await freshExtension();
    extension(pi);
    await handlers.session_start({}, ctx);

    await handlers.agent_settled({}, ctx);
    await handlers.agent_settled({}, ctx);
    assert.equal(compactCalls.length, 1, "overlapping settled events must share one compaction request");

    compactCalls[0].onError(new Error("simulated abort"));
    await handlers.agent_settled({}, ctx);
    assert.equal(compactCalls.length, 2, "an error callback must release the in-flight guard");
  } finally {
    restoreEnv(prev);
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("C-004 behavior 5: plain resume must not silently reuse a session that was stopped by a resource cap", () => {
  const text = readFileSync(join(REPO, "scripts/pi-team.ps1"), "utf8");
  // When a role was stopped by a resource limit, the task state carries
  // last_stop_reason / last_checkpoint_path (see behavior 3). A plain
  // `resume` must detect that constrained state and refuse or route to the
  // explicit checkpoint resume, instead of relaunching the same session_id.
  // Slice ONLY the Resume-Task function body (ending at the next function)
  // so later functions such as Resume-From-Checkpoint cannot satisfy the
  // assertions spuriously.
  const startIdx = text.indexOf("function Resume-Task");
  const endIdx = text.indexOf("function Read-Checkpoint");
  const resumeFunc = text.slice(startIdx, endIdx);
  assert.match(resumeFunc, /last_stop_reason|last_checkpoint_path|resumed_from_checkpoint/,
    "Resume-Task must check for a resource-limit stop before relaunching the same session");
  assert.match(resumeFunc, /Fail[^\n]*checkpoint|resume-checkpoint/,
    "Resume-Task must refuse or direct to resume-checkpoint when a constrained session is detected");
});
