// COMPRESSION-001 — atomic, credential-free, versioned task checkpoint
// writer. The checkpoint is a deterministic JSON document that captures the
// frozen compression policy, runtime statistics, the resource-limit stop
// reason, and a pointer list of artifacts the resume command must inject.
// The checkpoint deliberately omits API keys, OAuth tokens, host-absolute
// paths, and the session transcript itself.

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export const CHECKPOINT_VERSION = 1;
export const CHECKPOINT_SUBDIR = "checkpoints";
export const CHECKPOINT_FILENAME_PREFIX = "task-checkpoint";

const FORBIDDEN_VALUE_PATTERN = /(?:api[_-]?key|auth[_-]?token|access[_-]?token|bearer\s+[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})/i;
const HOST_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorktreeRelative(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  if (HOST_PATH_PATTERN.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (value.includes("..")) return false;
  return true;
}

function rejectSensitive(value, path) {
  if (typeof value === "string") {
    if (FORBIDDEN_VALUE_PATTERN.test(value)) {
      throw new Error(`checkpoint: forbidden credential-looking value at ${path || "<root>"}`);
    }
    if (HOST_PATH_PATTERN.test(value)) {
      throw new Error(`checkpoint: forbidden host path at ${path || "<root>"}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitive(entry, `${path || "<root>"}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      rejectSensitive(value[key], `${path || "<root>"}${path ? "." : ""}${key}`);
    }
  }
}

function ensureWorktreeRelativePaths(value, path) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => ensureWorktreeRelativePaths(entry, `${path || "<root>"}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (typeof child === "string" && /(?:_path|_dir|artifact)$/.test(key)) {
      if (!isWorktreeRelative(child)) {
        throw new Error(`checkpoint: ${path || "<root>"}${path ? "." : ""}${key} must be a worktree-relative path`);
      }
    } else if (isPlainObject(child) || Array.isArray(child)) {
      ensureWorktreeRelativePaths(child, `${path || "<root>"}${path ? "." : ""}${key}`);
    }
  }
}

function normalizeStats(stats) {
  if (!isPlainObject(stats)) {
    throw new Error("checkpoint: stats object is required");
  }
  const known = {
    tool_calls_in_segment: 0,
    compaction_attempts: 0,
    compaction_completed: 0,
    compaction_retries_exhausted: 0,
    output_token_limit_hits: 0,
    segment_count: 0,
  };
  const seen = new Set();
  for (const key of Object.keys(stats)) {
    if (!(key in known)) {
      throw new Error(`checkpoint: stats has unknown field "${key}"`);
    }
    if (seen.has(key)) {
      throw new Error(`checkpoint: stats has duplicate field "${key}"`);
    }
    seen.add(key);
    const value = stats[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new Error(`checkpoint: stats.${key} must be a non-negative integer`);
    }
    known[key] = value;
  }
  return known;
}

function normalizeStopReason(stopReason) {
  if (!isPlainObject(stopReason)) {
    throw new Error("checkpoint: stop_reason object is required");
  }
  if (typeof stopReason.code !== "string" || stopReason.code.length === 0) {
    throw new Error("checkpoint: stop_reason.code is required");
  }
  if (typeof stopReason.message !== "string" || stopReason.message.length === 0) {
    throw new Error("checkpoint: stop_reason.message is required");
  }
  return Object.freeze({
    code: stopReason.code,
    message: stopReason.message,
    triggered_by: typeof stopReason.triggered_by === "string" ? stopReason.triggered_by : "compression-extension",
  });
}

function normalizeFrozenPolicy(policy) {
  if (!isPlainObject(policy)) {
    throw new Error("checkpoint: frozen_policy object is required");
  }
  const fields = ["threshold_percent", "max_tool_calls_per_segment", "max_compact_retries", "output_token_limit"];
  const result = {};
  for (const field of fields) {
    if (!(field in policy)) {
      throw new Error(`checkpoint: frozen_policy.${field} is required`);
    }
    const value = policy[field];
    if (field === "threshold_percent") {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
        throw new Error(`checkpoint: frozen_policy.${field} must be in (0, 1]`);
      }
    } else {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`checkpoint: frozen_policy.${field} must be a non-negative integer`);
      }
    }
    result[field] = value;
  }
  return Object.freeze(result);
}

export function buildCheckpointDocument({ taskId, role, agentId, worktree, frozenPolicy, stats, stopReason, lastUsage, segments, injectedArtifacts, frozenProviderModel, resumeAllowed = true, contractPath, contractVersion, notes }) {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("checkpoint: taskId is required");
  }
  if (typeof role !== "string" || !role) {
    throw new Error("checkpoint: role is required");
  }
  if (typeof agentId !== "string" || !agentId) {
    throw new Error("checkpoint: agentId is required");
  }
  if (typeof worktree !== "string" || !worktree) {
    throw new Error("checkpoint: worktree is required");
  }
  const normalizedStats = normalizeStats(stats ?? {});
  const normalizedStopReason = normalizeStopReason(stopReason ?? {});
  const normalizedPolicy = normalizeFrozenPolicy(frozenPolicy ?? {});
  const frozenProvider = (() => {
    if (!isPlainObject(frozenProviderModel)) {
      throw new Error("checkpoint: frozen_provider_model object is required");
    }
    if (typeof frozenProviderModel.provider !== "string" || !frozenProviderModel.provider) {
      throw new Error("checkpoint: frozen_provider_model.provider is required");
    }
    if (typeof frozenProviderModel.model !== "string" || !frozenProviderModel.model) {
      throw new Error("checkpoint: frozen_provider_model.model is required");
    }
    return Object.freeze({ provider: frozenProviderModel.provider, model: frozenProviderModel.model });
  })();
  const normalizedUsage = isPlainObject(lastUsage)
    ? Object.freeze({
        tokens: typeof lastUsage.tokens === "number" ? lastUsage.tokens : null,
        context_window: typeof lastUsage.context_window === "number" ? lastUsage.context_window : null,
        percent: typeof lastUsage.percent === "number" ? lastUsage.percent : null,
      })
    : null;
  const normalizedSegments = Array.isArray(segments) ? segments : [];
  const normalizedArtifacts = Array.isArray(injectedArtifacts) ? injectedArtifacts : [];
  if (!normalizedArtifacts.every((entry) => isWorktreeRelative(entry))) {
    throw new Error("checkpoint: injected_artifacts must be a list of worktree-relative paths");
  }
  if (typeof contractPath !== "string" || !isWorktreeRelative(contractPath)) {
    throw new Error("checkpoint: contract_path must be a worktree-relative path");
  }
  if (typeof contractVersion !== "number" || !Number.isInteger(contractVersion) || contractVersion < 1) {
    throw new Error("checkpoint: contract_version must be a positive integer");
  }
  const checkpoint = Object.freeze({
    version: CHECKPOINT_VERSION,
    checkpoint_at: new Date().toISOString(),
    task_id: taskId,
    role,
    agent_id: agentId,
    worktree_basename: worktree.replace(/[\\/]+$/, "").split(/[\\/]/).pop(),
    contract_path: contractPath,
    contract_version: contractVersion,
    frozen_policy: normalizedPolicy,
    frozen_provider_model: frozenProvider,
    stats: Object.freeze(normalizedStats),
    stop_reason: normalizedStopReason,
    last_usage: normalizedUsage,
    segments: Object.freeze(normalizedSegments),
    injected_artifacts: Object.freeze(normalizedArtifacts),
    resume_allowed: resumeAllowed === true,
    notes: typeof notes === "string" ? notes : "",
  });
  rejectSensitive(checkpoint, "");
  ensureWorktreeRelativePaths(checkpoint, "");
  return checkpoint;
}

function checkpointBasename({ role, taskId, checkpointAt }) {
  const stamp = (typeof checkpointAt === "string" ? checkpointAt : new Date().toISOString())
    .replace(/[:.]/g, "-");
  return `${CHECKPOINT_FILENAME_PREFIX}-${taskId}-${role}-${stamp}.json`;
}

export function checkpointPath(stateRoot, { role, taskId, checkpointAt }) {
  return join(stateRoot, CHECKPOINT_SUBDIR, checkpointBasename({ role, taskId, checkpointAt }));
}

export async function writeCheckpoint(stateRoot, document) {
  if (typeof stateRoot !== "string" || !stateRoot) {
    throw new Error("checkpoint: stateRoot is required");
  }
  if (!isPlainObject(document) || typeof document.checkpoint_at !== "string") {
    throw new Error("checkpoint: document.checkpoint_at is required");
  }
  const target = checkpointPath(stateRoot, { role: document.role, taskId: document.task_id, checkpointAt: document.checkpoint_at });
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const text = `${JSON.stringify(document, null, 2)}\n`;
  await writeFile(temp, text, "utf8");
  await rename(temp, target);
  return target;
}

export function listCheckpoints(stateRoot, taskId, role) {
  const dir = join(stateRoot, CHECKPOINT_SUBDIR);
  // Implemented lazily via fs.readdir when the caller needs it; this helper
  // returns the directory name so the caller can enumerate without leaking
  // internals to the role model.
  return { directory: dir, taskId, role };
}

export function relativeArtifactPath(stateRoot, checkpoint, artifactPath) {
  if (typeof artifactPath !== "string" || !artifactPath) return null;
  const absolute = join(checkpoint.worktree ?? "", artifactPath);
  return relative(stateRoot, absolute);
}

export const __testing__ = {
  buildCheckpointDocument,
  rejectSensitive,
  ensureWorktreeRelativePaths,
  normalizeStats,
  normalizeStopReason,
  normalizeFrozenPolicy,
  isWorktreeRelative,
  checkpointPath,
};