// ISSUE-006 — Agent-side Blackboard update protocol for the three active
// Pi Team roles. This module is loaded by `.pi/communication/extensions/
// blackboard-update.ts` to keep the extension itself a thin shell. It
// exports three concerns:
//
//   1. ROLE_CHECKPOINTS: the observable lifecycle nodes each role must hit
//      via `blackboard_update`, classified as start / progress / blocked /
//      handoff / waiting. The map is the canonical "when" answer for the
//      Issue #6 report that Lead lost visibility into long-running slices.
//   2. validateAgentUpdate(role, previousEvent | null, input): synchronous
//      semantic validation. It enforces the field semantics the Lead needs
//      to triage a slice (activity = observed fact, next = concrete
//      follow-up, blocker = required when the state is a blocker) and
//      rejects "heartbeat" updates that would mask real progress.
//   3. LifecycleGate: an in-process tool-call gate that fires on the
//      first substantive tool call and after a bounded number of tool
//      calls without a blackboard update. It mirrors the compression
//      extension's gate contract (return `{ block, reason }`) but never
//      terminates the session, so it cannot recreate the ISSUE-006
//      compression-unit crash.
//
// The module never grants task control, completion authority, or peer
// communication. Validation outcomes only ever produce an event in the
// already-append-only Blackboard log; the Lead remains the only path for
// acceptance, scope changes, and inter-role coordination.

import { listAgentEvents } from "../../plugins/agent-blackboard/server/blackboard-core.mjs";

const ACTIVITY_MIN_LENGTH = 8;
const NEXT_MIN_LENGTH = 4;
const BLOCKER_MIN_LENGTH = 4;
const ACTIVITY_HEARTBEAT_PATTERN = new Set([
  "ok",
  "okay",
  "done",
  "still working",
  "still going",
  "working on it",
  "in progress",
  "no change",
  "no update",
  "heartbeat",
  "tbd",
  "todo",
  "wip",
  "...",
]);

// Each entry says: the role's state may ONLY appear at the listed
// checkpoint classes. The Lead reads these to know which phase of the
// pair lifecycle the slice is currently in.
export const ROLE_CHECKPOINTS = Object.freeze({
  researcher: Object.freeze({
    start: ["working"],
    progress: ["working"],
    blocked: ["blocked"],
    handoff: ["completed"],
    waiting: ["waiting"],
  }),
  executor: Object.freeze({
    start: ["working"],
    progress: ["working"],
    blocked: ["blocked"],
    handoff: ["ready_for_review"],
    waiting: ["waiting"],
  }),
  validator: Object.freeze({
    start: ["validating"],
    progress: ["validating"],
    blocked: ["blocked"],
    handoff: ["ready_for_acceptance", "changes_requested"],
    waiting: ["waiting"],
  }),
});

// States whose semantic payload MUST contain a non-empty `blocker`. A
// reviewer that says `changes_requested` without naming what changed, or
// an executor that says `blocked` without naming the obstacle, is the
// exact stale-information pattern reported in Issue #6.
const BLOCKER_REQUIRED_STATES = new Set(["blocked", "changes_requested"]);

// States that must carry a concrete `next` action. Terminal handoffs
// (e.g. `completed`, `ready_for_acceptance`) are the only exemptions —
// the Lead is the only next step and that is implied by the role and
// state, not by anything the Agent can author.
const NEXT_EXEMPT_STATES = new Set([
  "completed",
  "ready_for_acceptance",
  "ready_for_review",
  "changes_requested",
]);

function fail(message) {
  throw new Error(message);
}

function asNonEmptyString(value, field) {
  if (typeof value !== "string") fail(`${field} must be a string`);
  return value;
}

function normalized(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail("update must be a JSON object");
  return input;
}

function isHeartbeatText(value) {
  if (typeof value !== "string") return false;
  const collapsed = value.trim().toLowerCase().replace(/[.!?\s]+$/g, "");
  if (collapsed.length === 0) return true;
  if (ACTIVITY_HEARTBEAT_PATTERN.has(collapsed)) return true;
  if (/^[\s.·…]+$/.test(value)) return true;
  if (collapsed === "still working on it" || collapsed === "still going on it") return true;
  return false;
}

function describeCheckpoint(role, state) {
  const map = ROLE_CHECKPOINTS[role];
  if (!map) return null;
  for (const [checkpoint, states] of Object.entries(map)) {
    if (states.includes(state)) return checkpoint;
  }
  return null;
}

export function isCheckpointState(role, state) {
  return describeCheckpoint(role, state) !== null;
}

export function checkpointFor(role, state) {
  return describeCheckpoint(role, state);
}

// Validate a single blackboard_update call. Throws on violation. The
// caller (the tool execute function) is responsible for converting the
// thrown Error into a `block: true` response.
export function validateAgentUpdate(role, previousEvent, rawInput) {
  if (typeof role !== "string" || !Object.hasOwn(ROLE_CHECKPOINTS, role)) {
    fail(`unknown role for Blackboard update: ${role}`);
  }
  const input = normalized(rawInput);
  const state = asNonEmptyString(input.state, "state");
  if (!isCheckpointState(role, state)) {
    const allowed = Object.values(ROLE_CHECKPOINTS[role]).flat().join(", ");
    fail(`state ${state} is not a Blackboard lifecycle checkpoint for ${role}; allowed: ${allowed}`);
  }
  const activity = asNonEmptyString(input.activity, "activity");
  if (activity.length > 240) fail("activity must be at most 240 characters");
  if (activity.length < ACTIVITY_MIN_LENGTH) {
    fail(`activity must be at least ${ACTIVITY_MIN_LENGTH} characters and describe an observed fact`);
  }
  if (isHeartbeatText(activity)) {
    fail("activity is a meaningless heartbeat; describe an observed fact, the file you changed, or the next concrete step");
  }
  if (BLOCKER_REQUIRED_STATES.has(state)) {
    if (input.blocker === undefined) {
      fail(`state ${state} requires a non-empty blocker describing the obstacle or required correction`);
    }
    const blocker = asNonEmptyString(input.blocker, "blocker");
    if (blocker.length < BLOCKER_MIN_LENGTH || blocker.length > 500) {
      fail(`blocker must be ${BLOCKER_MIN_LENGTH}-500 characters`);
    }
  } else if (input.blocker !== undefined) {
    fail(`state ${state} must not include a blocker; report risks in activity or next instead`);
  }
  if (!NEXT_EXEMPT_STATES.has(state)) {
    if (input.next === undefined) {
      fail(`state ${state} requires a non-empty next action so Lead can triage progress`);
    }
    const next = asNonEmptyString(input.next, "next");
    if (next.length < NEXT_MIN_LENGTH || next.length > 500) {
      fail(`next must be ${NEXT_MIN_LENGTH}-500 characters`);
    }
    if (isHeartbeatText(next)) {
      fail("next must be a concrete follow-up; placeholder text such as 'continue' or 'tbd' is not enough");
    }
  } else if (input.next !== undefined) {
    const next = asNonEmptyString(input.next, "next");
    if (next.length > 500) fail("next must be at most 500 characters");
  }
  if (previousEvent && previousEvent.state === state && previousEvent.activity === activity) {
    fail(`update repeats the previous ${state} event verbatim; produce a new observed fact or change state before re-publishing`);
  }
  return {
    role,
    state,
    checkpoint: describeCheckpoint(role, state),
    previous_sequence: previousEvent ? previousEvent.sequence : 0,
  };
}

// Bounded tool-call gate. The agent's role must publish a Blackboard
// event before the first substantive tool call and at most every
// `maxToolCallsBetweenUpdates` substantive tool calls. The gate fails
// open after `maxBypasses` consecutive blocks so a misbehaving model
// cannot deadlock the session; each bypass is recorded so tests can
// verify the escape hatch fired (or, more importantly, that it never
// fired under normal use).
export const DEFAULT_LIFECYCLE_GATE = Object.freeze({ maxToolCallsBetweenUpdates: 20 });

const SUBSTANTIVE_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "edit",
  "write",
  "web_search",
  "fetch_content",
  "get_search_content",
  "source_check",
  "pi_team_intercom",
]);

function isSubstantiveToolCall(event) {
  if (!event || typeof event !== "object") return false;
  const name = event.toolName;
  if (typeof name !== "string") return false;
  if (name === "blackboard_update") return false;
  return SUBSTANTIVE_TOOLS.has(name);
}

export function createLifecycleGate(options = {}) {
  const config = { ...DEFAULT_LIFECYCLE_GATE, ...options };
  let published = false;
  let sinceUpdate = 0;
  const history = [];
  return {
    config,
    get published() { return published; },
    get sinceUpdate() { return sinceUpdate; },
    get bypasses() { return 0; },
    get history() { return history.slice(); },
    markPublished() {
      published = true;
      sinceUpdate = 0;
    },
    evaluate(event) {
      if (!isSubstantiveToolCall(event)) return { block: false, remind: false };
      sinceUpdate += 1;
      if (sinceUpdate % config.maxToolCallsBetweenUpdates !== 0) return { block: false, remind: false };
      const reason = `blackboard-reminder: ${sinceUpdate} substantive tool calls since the last Blackboard update; publish observed progress when appropriate`;
      history.push({ at: "remind", sinceUpdate, published });
      return { block: false, remind: true, reason };
    },
  };
}

// Convenience: read the role's most recent event from the Blackboard
// store so the extension can hand it to validateAgentUpdate without
// keeping in-process caches. Uses the public blackboard-core API so
// the same code path works across resumes, sessions, and concurrent
// role files. The window MUST be wide enough to include the role's
// own latest event even when other roles published more recently;
// `listAgentEvents` sorts globally by (observed_at, sequence) and the
// previous role-local event can sit behind any number of peer events.
const READ_PREVIOUS_WINDOW = 500;

export async function readPreviousEvent(stateRoot, taskId, role, currentSequence) {
  if (!stateRoot || !taskId || !role) return null;
  const events = await listAgentEvents(stateRoot, taskId, { limit: READ_PREVIOUS_WINDOW });
  let latest = null;
  for (const event of events) {
    if (event.role !== role) continue;
    if (typeof currentSequence === "number" && event.sequence >= currentSequence) continue;
    if (!latest || event.sequence > latest.sequence) latest = event;
  }
  return latest;
}

export const __testing__ = {
  ACTIVITY_HEARTBEAT_PATTERN,
  BLOCKER_REQUIRED_STATES,
  NEXT_EXEMPT_STATES,
  isHeartbeatText,
  describeCheckpoint,
  DEFAULT_LIFECYCLE_GATE,
};
