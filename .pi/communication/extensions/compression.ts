// COMPRESSION-001 — unified auto-compression extension for the three active
// Pi Team roles. Loads `.pi/team-runtime.json` from the worktree, resolves
// the current role's effective policy (with role-card overrides), tracks
// per-segment tool-call counts and compaction retries, and writes a
// credential-free, versioned checkpoint when a resource limit is hit.
//
// The extension deliberately uses only Pi-published event APIs:
//   - session_start: load and validate the project policy.
//   - tool_call: increment the per-segment counter; on overflow, persist a
//     checkpoint and request a graceful shutdown when a cap is configured.
//   - session_before_compact / session_compact: track retries; reset the
//     per-segment counter when compaction succeeds.
//   - turn_end: read ctx.getContextUsage() and trigger ctx.compact() when
//     the threshold is crossed and a retry budget remains.
//
// The extension never reads API keys, OAuth tokens, or host-absolute paths
// and never includes them in checkpoints. It does not modify Blackboard,
// heartbeat, or task concurrency.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile, rename as renameFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  loadTeamRuntimeConfig,
  resolveCompressionPolicy,
  ACTIVE_ROLE_NAMES,
} from "../team-runtime.mjs";
import {
  buildCheckpointDocument,
  writeCheckpoint,
  CHECKPOINT_VERSION,
} from "../checkpoint.mjs";

type CompactPolicy = {
  threshold_percent: number;
  max_tool_calls_per_segment: number;
  max_compact_retries: number;
  output_token_limit: number;
};

type SegmentStats = {
  tool_calls_in_segment: number;
  compaction_attempts: number;
  compaction_completed: number;
  compaction_retries_exhausted: number;
  output_token_limit_hits: number;
  segment_count: number;
};

type RuntimeState = {
  policy: CompactPolicy;
  stats: SegmentStats;
  stopped: boolean;
  stopReason: { code: string; message: string; triggered_by: string } | null;
  checkpointPath: string | null;
  segmentSinceLastCompact: number;
  hasInjectedContract: boolean;
};

const ROLE_ENV = process.env.PI_TEAM_ROLE ?? "";
const TASK_ID_ENV = process.env.PI_TEAM_TASK_ID ?? "";
const AGENT_ID_ENV = process.env.PI_TEAM_AGENT_ID ?? "";
const WORKTREE_ENV = process.env.PI_TEAM_WORKTREE ?? process.cwd();
const STATE_ROOT_ENV = process.env.PI_TEAM_STATE_ROOT ?? "";

function freshStats(): SegmentStats {
  return {
    tool_calls_in_segment: 0,
    compaction_attempts: 0,
    compaction_completed: 0,
    compaction_retries_exhausted: 0,
    output_token_limit_hits: 0,
    segment_count: 0,
  };
}

function emptyState(policy: CompactPolicy): RuntimeState {
  return {
    policy,
    stats: freshStats(),
    stopped: false,
    stopReason: null,
    checkpointPath: null,
    segmentSinceLastCompact: 0,
    hasInjectedContract: false,
  };
}

async function loadFrozenProviderModel(stateRoot: string, taskId: string): Promise<{ provider: string; model: string } | null> {
  if (!stateRoot || !taskId) return null;
  const taskStatePath = join(stateRoot, `${taskId}.json`);
  let text: string;
  try {
    text = await readFile(taskStatePath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    const frozen = parsed?.frozen_provider_model;
    if (frozen && typeof frozen.provider === "string" && typeof frozen.model === "string") {
      return { provider: frozen.provider, model: frozen.model };
    }
    const provider = parsed?.provider;
    const model = parsed?.model;
    if (typeof provider === "string" && typeof model === "string") {
      return { provider, model };
    }
    return null;
  } catch {
    return null;
  }
}

async function loadContractVersion(stateRoot: string, taskId: string): Promise<number> {
  if (!stateRoot || !taskId) return 1;
  const path = join(stateRoot, `${taskId}.json`);
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (typeof parsed?.contract_version === "number") return parsed.contract_version;
  } catch {
    // ignore
  }
  return 1;
}

async function loadContractPath(stateRoot: string, taskId: string): Promise<string> {
  if (!stateRoot || !taskId) return "";
  const path = join(stateRoot, `${taskId}.json`);
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (typeof parsed?.contract_path === "string") {
      const basename = parsed.contract_path.split(/[\\/]/).pop() ?? "";
      return basename;
    }
  } catch {
    // ignore
  }
  return "";
}

async function persistTaskState(stateRoot: string, taskId: string, snapshot: Record<string, unknown>): Promise<void> {
  if (!stateRoot || !taskId) return;
  const path = join(stateRoot, `${taskId}.json`);
  let existing: Record<string, unknown> = {};
  try {
    const text = await readFile(path, "utf8");
    existing = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    // no existing state; create a new one
  }
  const merged = { ...existing, ...snapshot, last_checkpoint_at: new Date().toISOString() };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await renameFile(temp, path);
}

function triggerLimitShutdown(ctx: ExtensionContext, state: RuntimeState, code: string, message: string) {
  if (state.stopped) return;
  // Mark the role as stopped so the live event handlers refuse further
  // work, but DO NOT flip `state.stopped` here. `session_shutdown` owns
  // the final transition and must run run unconditionally when a stop
  // reason is set, otherwise the resource-cap stop never persists the
  // checkpoint and task-state stop record.
  state.stopReason = { code, message, triggered_by: "compression-extension" };
  if (ctx.hasUI) {
    ctx.ui.notify(`${state.stopReason.code}: ${state.stopReason.message}`, "warning");
  }
}

export default function (pi: ExtensionAPI) {
  if (!ACTIVE_ROLE_NAMES.has(ROLE_ENV)) return;
  if (!TASK_ID_ENV) return;
  if (!STATE_ROOT_ENV) return;

  let runtime: RuntimeState | null = null;

  pi.on("session_start", async (_event, ctx) => {
    try {
      const config = await loadTeamRuntimeConfig(WORKTREE_ENV);
      const policy = resolveCompressionPolicy(ROLE_ENV, config);
      runtime = emptyState(policy);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ctx.hasUI) {
        ctx.ui.notify(`Compression extension disabled: ${message}`, "error");
      }
      runtime = null;
    }
  });

  pi.on("tool_call", async (event, _ctx) => {
    const state = runtime;
    if (!state || state.stopped) return undefined;
    if (state.stopReason) return { block: true, reason: `compression-extension: role ${ROLE_ENV} already stopped (${state.stopReason.code}); awaiting session_shutdown`, terminate: true };
    state.segmentSinceLastCompact += 1;
    const limit = state.policy.max_tool_calls_per_segment;
    if (limit > 0 && state.segmentSinceLastCompact > limit) {
      state.stats.tool_calls_in_segment = state.segmentSinceLastCompact;
      triggerLimitShutdown(
        _ctx,
        state,
        "tool_call_segment_limit",
        `Per-segment tool-call limit reached (${state.segmentSinceLastCompact}/${limit}); role ${ROLE_ENV} must checkpoint and stop.`,
      );
      // The checkpoint is deferred to session_shutdown; do NOT lie about a
      // successful persist here. The role still terminates immediately so Pi
      // emits session_shutdown promptly.
      state.stopped = true;
      return { block: true, reason: `compression-extension: per-segment tool-call limit reached (${state.segmentSinceLastCompact}/${limit}); role ${ROLE_ENV} is stopping, checkpoint will be written on session_shutdown`, terminate: true };
    }
    return undefined;
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const state = runtime;
    if (!state || state.stopped) return undefined;
    if (state.stopReason) return { cancel: true };
    state.stats.compaction_attempts += 1;
    if (state.stats.compaction_attempts - state.stats.compaction_completed > state.policy.max_compact_retries) {
      state.stats.compaction_retries_exhausted += 1;
      const retries = state.policy.max_compact_retries;
      triggerLimitShutdown(
        ctx,
        state,
        "compact_retry_limit",
        `Compaction retry budget exhausted (${retries}); role ${ROLE_ENV} must checkpoint and stop.`,
      );
      state.stopped = true;
      return { cancel: true };
    }
    return undefined;
  });

  pi.on("session_compact", async (event, ctx) => {
    const state = runtime;
    if (!state) return;
    state.stats.compaction_completed += 1;
    state.stats.segment_count += 1;
    state.segmentSinceLastCompact = 0;
  });

  pi.on("turn_end", async (event, ctx) => {
    const state = runtime;
    if (!state || state.stopped) return;
    let usage: { tokens?: number | null; contextWindow?: number; percent?: number | null } | undefined;
    try {
      usage = ctx.getContextUsage();
    } catch {
      usage = undefined;
    }
    if (!usage || typeof usage.contextWindow !== "number" || usage.contextWindow <= 0) return;
    // Pi's ContextUsage.percent is expressed as a percentage in the range
    // 0..100, while the team policy deliberately stores thresholds as ratios
    // in the range 0..1. Normalize at the API boundary so both paths use the
    // policy's ratio semantics consistently.
    const percent = typeof usage.percent === "number" ? usage.percent / 100 : null;
    const tokens = typeof usage.tokens === "number" ? usage.tokens : null;
    const effectivePercent = percent ?? (tokens === null ? null : tokens / usage.contextWindow);
    if (effectivePercent === null) return;
    const threshold = state.policy.threshold_percent;
    if (effectivePercent < threshold) return;
    if (state.stats.compaction_attempts - state.stats.compaction_completed >= state.policy.max_compact_retries) return;
    ctx.compact({
      customInstructions:
        `Auto-compaction triggered by Pi Team runtime policy: context usage ${(effectivePercent * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(1)}% threshold. ` +
        `Preserve the frozen contract identity, the latest worktree-relative artifact paths, and the open implementation decisions. Drop redundant tool transcripts.`,
    });
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    const state = runtime;
    if (!state || !state.stopReason) return;
    // Mark stopped now: this is the single point that owns the final
    // transition. If the write fails we still want subsequent turns to
    // see a stopped state and refuse further work.
    state.stopped = true;
    try {
      const frozenProviderModel = (await loadFrozenProviderModel(STATE_ROOT_ENV, TASK_ID_ENV))
        ?? { provider: process.env?.defaultProvider ?? "minimax-cn", model: process.env?.defaultModel ?? "MiniMax-M3" };
      const contractVersion = await loadContractVersion(STATE_ROOT_ENV, TASK_ID_ENV);
      const contractPath = await loadContractPath(STATE_ROOT_ENV, TASK_ID_ENV) || `contracts/${TASK_ID_ENV}.md`;
      const document = buildCheckpointDocument({
        taskId: TASK_ID_ENV,
        role: ROLE_ENV,
        agentId: AGENT_ID_ENV,
        worktree: WORKTREE_ENV,
        frozenPolicy: state.policy,
        stats: state.stats,
        stopReason: state.stopReason,
        lastUsage: { tokens: null, context_window: null, percent: null },
        segments: [],
        injectedArtifacts: [],
        frozenProviderModel,
        resumeAllowed: true,
        contractPath,
        contractVersion,
        notes: `Auto-checkpoint written by compression extension; resume with pi-team.cmd resume-checkpoint ${TASK_ID_ENV} <checkpoint-path>.`,
      });
      const path = await writeCheckpoint(STATE_ROOT_ENV, document);
      state.checkpointPath = path;
      await persistTaskState(STATE_ROOT_ENV, TASK_ID_ENV, {
        last_checkpoint_path: path,
        last_checkpoint_version: CHECKPOINT_VERSION,
        last_stop_reason: state.stopReason,
        last_frozen_policy: state.policy,
        last_stats: state.stats,
        last_role: ROLE_ENV,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (_ctx?.hasUI) {
        _ctx.ui.notify(`Compression checkpoint write failed: ${message}`, "error");
      }
    }
  });
}
