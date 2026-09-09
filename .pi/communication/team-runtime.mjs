// COMPRESSION-001 — project-level runtime configuration loader for the
// Pi Team compression extension. The loader reads `.pi/team-runtime.json`
// from the worktree root and returns a frozen, validated policy object that
// the active role extensions consume. The loader never reads from the host's
// user-level Pi settings; project-level policy is authoritative inside a task
// worktree. Credentials (API keys, auth tokens, host paths) are explicitly
// forbidden in the policy payload.

import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";

export const TEAM_RUNTIME_CONFIG_VERSION = 1;
export const TEAM_RUNTIME_CONFIG_FILENAME = ".pi/team-runtime.json";

export const ACTIVE_ROLE_NAMES = new Set(["researcher", "executor", "reviewer"]);

export const COMPRESSION_DEFAULTS = Object.freeze({
  threshold_percent: 0.5,
  // Disabled by default. Set a positive integer when an explicit tool-call
  // budget is needed for a constrained run.
  max_tool_calls_per_segment: 0,
  max_compact_retries: 1,
  output_token_limit: 65536,
});

// Strict ranges for scalar fields. The bounds are conservative: thresholds
// must be in (0, 1]; tool-call and retry caps are small non-negative
// integers (zero disables the tool-call cap); the output token limit is a
// positive integer at most 1MiB.
const THRESHOLD_RANGE = { min: 0, max: 1, exclusiveMin: false };
const TOOL_CALL_RANGE = { min: 0, max: 1000 };
const RETRY_RANGE = { min: 0, max: 5 };
const OUTPUT_TOKEN_RANGE = { min: 1024, max: 1048576 };

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.trunc(value) === value;
}

function assertRange(name, value, range) {
  if (!isInteger(value)) throw new Error(`team-runtime: ${name} must be an integer`);
  if (value < range.min || value > range.max) {
    throw new Error(`team-runtime: ${name} must be in [${range.min}, ${range.max}]`);
  }
}

function assertThreshold(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`team-runtime: ${name} must be a finite number`);
  }
  if (value <= THRESHOLD_RANGE.min || value > THRESHOLD_RANGE.max) {
    throw new Error(`team-runtime: ${name} must be in (${THRESHOLD_RANGE.min}, ${THRESHOLD_RANGE.max}]`);
  }
}

// Fields that are explicitly rejected when present anywhere inside the
// config payload. API keys, tokens, and host-absolute paths must never reach
// the checkpoint writer or the policy loader. Comparison is value-based so
// that nested `role_overrides.<role>.api_key` is also rejected.
const FORBIDDEN_KEYS = new Set(["api_key", "apiKey", "token", "auth", "password", "secret"]);
const HOST_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

function rejectSensitiveFields(path, value) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(lower) || FORBIDDEN_KEYS.has(key)) {
      throw new Error(`team-runtime: forbidden field "${key}" at ${path || "<root>"}${path ? "." : ""}${key}`);
    }
    const child = value[key];
    if (typeof child === "string" && HOST_PATH_PATTERN.test(child)) {
      throw new Error(`team-runtime: forbidden host path at ${path || "<root>"}${path ? "." : ""}${key}`);
    }
    if (isPlainObject(child)) rejectSensitiveFields(`${path || ""}${path ? "." : ""}${key}`, child);
  }
}

function validateRoleOverride(role, raw) {
  if (!isPlainObject(raw)) {
    throw new Error(`team-runtime: compression.role_overrides.${role} must be an object`);
  }
  const allowed = new Set(["threshold_percent", "max_tool_calls_per_segment", "max_compact_retries"]);
  const seen = new Set();
  const result = {};
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new Error(`team-runtime: compression.role_overrides.${role} has unknown field "${key}"`);
    }
    if (seen.has(key)) {
      throw new Error(`team-runtime: compression.role_overrides.${role} has duplicate field "${key}"`);
    }
    seen.add(key);
    const value = raw[key];
    if (key === "threshold_percent") {
      assertThreshold(`compression.role_overrides.${role}.threshold_percent`, value);
    } else if (key === "max_tool_calls_per_segment") {
      assertRange(`compression.role_overrides.${role}.max_tool_calls_per_segment`, value, TOOL_CALL_RANGE);
    } else if (key === "max_compact_retries") {
      assertRange(`compression.role_overrides.${role}.max_compact_retries`, value, RETRY_RANGE);
    }
    result[key] = value;
  }
  return result;
}

export function validateCompressionConfig(raw) {
  if (!isPlainObject(raw)) {
    throw new Error("team-runtime: payload must be a JSON object");
  }
  if (raw.version !== TEAM_RUNTIME_CONFIG_VERSION) {
    throw new Error(`team-runtime: version must be ${TEAM_RUNTIME_CONFIG_VERSION}`);
  }
  rejectSensitiveFields("", raw);
  const compression = raw.compression;
  if (!isPlainObject(compression)) {
    throw new Error("team-runtime: compression object is required");
  }
  const defaults = {};
  for (const field of Object.keys(compression)) {
    if (field === "role_overrides") continue;
    if (!(field in COMPRESSION_DEFAULTS)) {
      throw new Error(`team-runtime: compression has unknown field "${field}"`);
    }
  }
  for (const field of Object.keys(COMPRESSION_DEFAULTS)) {
    if (field === "role_overrides") continue;
    if (!(field in compression)) continue;
    const value = compression[field];
    if (field === "threshold_percent") {
      assertThreshold(`compression.${field}`, value);
    } else if (field === "max_tool_calls_per_segment") {
      assertRange(`compression.${field}`, value, TOOL_CALL_RANGE);
    } else if (field === "max_compact_retries") {
      assertRange(`compression.${field}`, value, RETRY_RANGE);
    } else if (field === "output_token_limit") {
      assertRange(`compression.${field}`, value, OUTPUT_TOKEN_RANGE);
    }
    defaults[field] = value;
  }
  const mergedDefaults = { ...COMPRESSION_DEFAULTS, ...defaults };

  const overrides = {};
  if ("role_overrides" in compression) {
    const rawOverrides = compression.role_overrides;
    if (!isPlainObject(rawOverrides)) {
      throw new Error("team-runtime: compression.role_overrides must be an object");
    }
    const seenRoles = new Set();
    for (const role of Object.keys(rawOverrides)) {
      if (!ACTIVE_ROLE_NAMES.has(role)) {
        throw new Error(`team-runtime: compression.role_overrides has unknown role "${role}"`);
      }
      if (seenRoles.has(role)) {
        throw new Error(`team-runtime: compression.role_overrides has duplicate role "${role}"`);
      }
      seenRoles.add(role);
      overrides[role] = validateRoleOverride(role, rawOverrides[role]);
    }
  }
  return Object.freeze({
    version: TEAM_RUNTIME_CONFIG_VERSION,
    defaults: Object.freeze(mergedDefaults),
    role_overrides: Object.freeze(overrides),
  });
}

export function resolveCompressionPolicy(role, config) {
  if (!ACTIVE_ROLE_NAMES.has(role)) {
    throw new Error(`team-runtime: unknown role "${role}"`);
  }
  const overrides = config.role_overrides[role] ?? {};
  const merged = { ...config.defaults, ...overrides };
  return Object.freeze({
    threshold_percent: merged.threshold_percent,
    max_tool_calls_per_segment: merged.max_tool_calls_per_segment,
    max_compact_retries: merged.max_compact_retries,
    output_token_limit: merged.output_token_limit,
  });
}

export async function loadTeamRuntimeConfig(worktree) {
  if (!worktree || typeof worktree !== "string" || !isAbsolute(worktree)) {
    throw new Error("team-runtime: worktree must be an absolute path");
  }
  const path = join(worktree, TEAM_RUNTIME_CONFIG_FILENAME);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return validateCompressionConfig({
        version: TEAM_RUNTIME_CONFIG_VERSION,
        compression: { ...COMPRESSION_DEFAULTS, role_overrides: {} },
      });
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`team-runtime: invalid JSON in ${path}: ${error.message}`);
  }
  return validateCompressionConfig(parsed);
}

export const __testing__ = {
  COMPRESSION_DEFAULTS,
  THRESHOLD_RANGE,
  TOOL_CALL_RANGE,
  RETRY_RANGE,
  OUTPUT_TOKEN_RANGE,
  rejectSensitiveFields,
  validateCompressionConfig,
  resolveCompressionPolicy,
};
