import { isAbsolute, resolve } from "node:path";

// `reviewer` belongs to historic task records only. New runtime state uses
// Validator; source isolation is prompt policy, not a claimed sandbox.
export const ROLES = Object.freeze(["researcher", "executor", "validator"]);
export const ROLE_STATES = Object.freeze({
  researcher: Object.freeze(["working", "waiting", "blocked", "completed"]),
  executor: Object.freeze(["working", "waiting", "blocked", "ready_for_validation"]),
  validator: Object.freeze(["working", "waiting", "blocked", "validating", "changes_requested", "ready_for_acceptance"]),
});
export const TASK_STATUSES = Object.freeze(["active", "accepted", "incomplete", "archived"]);
export const LEAD_WAKE_STATES = Object.freeze(["blocked", "changes_requested", "ready_for_validation", "ready_for_acceptance", "completed"]);
export const ROLE_CHECKPOINTS = Object.freeze({
  researcher: Object.freeze({ complete: ["completed"], blocked: ["blocked"], waiting: ["waiting"] }),
  executor: Object.freeze({ ready: ["ready_for_validation"], blocked: ["blocked"], waiting: ["waiting"] }),
  validator: Object.freeze({ ready: ["ready_for_acceptance"], changes_requested: ["changes_requested"], blocked: ["blocked"], waiting: ["waiting"] }),
});

export function fail(message) { throw new Error(message); }
export function ensureTaskId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) fail("invalid task_id");
  return value;
}
export function ensureRole(value) {
  if (!ROLES.includes(value)) fail(`invalid role: ${value}`);
  return value;
}
export function ensureTaskStatus(value) {
  if (!TASK_STATUSES.includes(value)) fail(`invalid task status: ${value}`);
  return value;
}
export function ensureAbsolutePath(value, field) {
  if (typeof value !== "string" || !isAbsolute(value)) fail(`${field} must be an absolute path`);
  return resolve(value);
}
export function ensureLine(value, field, max, required = false) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && !value) || value.length > max || /[\r\n]/.test(value)) {
    fail(`${field} must be a single line of at most ${max} characters`);
  }
  return value;
}
export function ensureDescription(value) {
  if (typeof value !== "string" || !value || value.length > 20_000) fail("description must be non-empty and at most 20000 characters");
  return value;
}
export function contractDescription(input) {
  const description = typeof input?.description === "string" ? input.description : "";
  if (description) return ensureDescription(description);
  const objective = typeof input?.objective === "string" ? input.objective : "";
  const context = Array.isArray(input?.context) ? input.context.filter((item) => typeof item === "string" && item) : [];
  return ensureDescription([objective, context.length ? `Context: ${context.join(" ")}` : ""].filter(Boolean).join(" "));
}

export function validateAgentIdentity(identity) {
  if (!identity || typeof identity !== "object") fail("agent identity is required");
  ensureTaskId(identity.task_id);
  ensureRole(identity.role);
  ensureLine(identity.agent_id, "agent_id", 240, true);
  ensureAbsolutePath(identity.worktree, "worktree");
  return {
    task_id: identity.task_id,
    role: identity.role,
    agent_id: identity.agent_id,
    worktree: resolve(identity.worktree),
    ...(identity.session_id ? { session_id: ensureLine(identity.session_id, "session_id", 240, true) } : {}),
  };
}

export function validateTaskRecord(task) {
  if (!task || typeof task !== "object") fail("task record is required");
  ensureTaskId(task.task_id);
  ensureLine(task.name, "name", 240, true);
  ensureDescription(task.description);
  ensureTaskStatus(task.status);
  if (task.branch !== undefined) ensureLine(task.branch, "branch", 240, true);
  if (task.worktree !== undefined) ensureAbsolutePath(task.worktree, "worktree");
  return task;
}

export function validateAgentEvent(identity, input, sequence) {
  const id = validateAgentIdentity(identity);
  if (!input || typeof input !== "object") fail("agent event is required");
  const state = ensureLine(input.state, "state", 80, true);
  if (!ROLE_STATES[id.role].includes(state)) fail(`state ${state} is not allowed for role ${id.role}`);
  const activity = ensureLine(input.activity, "activity", 240, true);
  const blocker = ensureLine(input.blocker, "blocker", 500);
  const next = ensureLine(input.next, "next", 500);
  if (state === "blocked" || state === "changes_requested") {
    if (!blocker) fail(`${state} requires blocker`);
  } else if (!["completed", "ready_for_validation", "ready_for_acceptance", "changes_requested"].includes(state) && !next) {
    fail(`${state} requires next`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) fail("sequence must be a positive integer");
  return {
    version: 1,
    task_id: id.task_id,
    role: id.role,
    agent_id: id.agent_id,
    worktree: id.worktree,
    sequence,
    state,
    activity,
    ...(blocker !== undefined ? { blocker } : {}),
    ...(next !== undefined ? { next } : {}),
    observed_at: new Date().toISOString(),
  };
}

export function validateAgentUpdate(role, previous, input) {
  ensureRole(role);
  if (!input || input.role !== undefined && input.role !== role) fail("role is controlled by runtime identity");
  if (previous && previous.state === input.state && previous.activity === input.activity && previous.blocker === input.blocker && previous.next === input.next) {
    fail("identical repeat of previous event is refused");
  }
  return true;
}

export function wakeupFromEvent(event) {
  if (!LEAD_WAKE_STATES.includes(event.state)) return null;
  return {
    id: `${event.task_id}:${event.role}:${event.sequence}`,
    version: 1,
    task_id: event.task_id,
    role: event.role,
    sequence: event.sequence,
    state: event.state,
    activity: event.activity,
    created_at: event.observed_at,
    status: "pending",
    ...(event.blocker !== undefined ? { blocker: event.blocker } : {}),
    ...(event.next !== undefined ? { next: event.next } : {}),
  };
}

export function encodeCursor(files) { return Buffer.from(JSON.stringify({ version: 1, files }), "utf8").toString("base64url"); }
export function decodeCursor(cursor) {
  if (!cursor) return {};
  try {
    const decoded = typeof cursor === "object" ? cursor : JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!decoded || decoded.version !== 1 || !decoded.files || Array.isArray(decoded.files)) fail("invalid runtime cursor");
    return decoded.files;
  } catch (error) { if (error.message === "invalid runtime cursor") throw error; fail("invalid runtime cursor"); }
}

export const __testing__ = Object.freeze({ validateAgentEvent, validateTaskRecord });
