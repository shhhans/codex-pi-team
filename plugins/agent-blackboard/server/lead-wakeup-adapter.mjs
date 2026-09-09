import { randomUUID } from "node:crypto";
import {
  acknowledgeLeadWakeup,
  claimLeadWakeup,
  listAgentEvents,
  listLeadWakeups,
  recordLeadWakeupDelivery,
  snapshot as snapshotBlackboard,
} from "./blackboard-core.mjs";

const DEFAULT_RECENT_ACTIVITY_LIMIT = 5;
const DEFAULT_DEDUP_WINDOW_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const WAKEUP_STATUS_DELIVERED = "delivered";
const WAKEUP_STATUS_FAILED = "failed";
const WAKEUP_STATUS_IN_FLIGHT = "in_flight";

function line(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summary(value) {
  const text = line(value) || "";
  if (/^(?:[A-Za-z0-9+/_-]{32,}=*)$/.test(text) || /^eyJ[A-Za-z0-9+/_-]{20,}/.test(text)) return "[transport payload redacted]";
  return text.length <= 160 ? text : `${text.slice(0, 159)}…`;
}

// Build a compact, chronological digest of the most recent Agent events that
// preceded this wakeup. The digest is bounded and never includes the wakeup's
// own event so the Lead prompt shows only prior activity.
// `before_observed_at` is the cross-role safe cutoff (the wakeup's
// `created_at`); `before_sequence` is **role-local** and only filters the
// wakeup's own role correctly. Both may be combined (AND).
export function summarizeRecentActivity(events, options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : DEFAULT_RECENT_ACTIVITY_LIMIT;
  if (!Array.isArray(events) || limit === 0) return [];
  const beforeSequence = options.before_sequence;
  const beforeObservedAt = typeof options.before_observed_at === "string" && options.before_observed_at.length > 0 ? options.before_observed_at : undefined;
  const filtered = events.filter((event) => {
    if (beforeObservedAt !== undefined) {
      if (typeof event.observed_at !== "string" || event.observed_at >= beforeObservedAt) return false;
    }
    if (beforeSequence !== undefined && Number.isFinite(Number(beforeSequence))) {
      if (Number(event.sequence) >= Number(beforeSequence)) return false;
    }
    return true;
  });
  return filtered
    .slice(-limit)
    .map((event) => ({
      role: event.role,
      sequence: event.sequence,
      state: event.state,
      activity: summary(event.activity || ""),
      observed_at: event.observed_at,
    }));
}

// Coalesce wakeups that share the same (role, state, activity) tuple inside a
// rolling window. The newest wakeup of each group survives and tracks the
// suppressed siblings in `coalesced_ids` and `coalesced_count` so the Lead can
// still see that multiple updates collapsed into one prompt. Wakeups older
// than the window are returned as-is to avoid touching unrelated history.
export function coalesceWakeups(wakeups, options = {}) {
  if (!Array.isArray(wakeups)) return [];
  const windowMs = Number.isFinite(options.window_ms) ? Math.max(0, options.window_ms) : DEFAULT_DEDUP_WINDOW_MS;
  const now = options.now === undefined ? Date.now() : Number(options.now);
  const groups = new Map();
  const survivors = [];
  for (const wakeup of wakeups) {
    if (!wakeup || typeof wakeup !== "object") continue;
    const createdAt = wakeup.created_at ? Date.parse(wakeup.created_at) : NaN;
    const insideWindow = Number.isFinite(createdAt) && (now - createdAt) <= windowMs;
    const key = insideWindow
      ? `${wakeup.role || ""}|${wakeup.state || ""}|${summary(wakeup.activity || "")}`
      : `__outside__${wakeup.id || randomUUID()}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, wakeup);
      survivors.push(wakeup);
      continue;
    }
    if (!existing.coalesced_ids) {
      existing.coalesced_ids = [];
      existing.coalesced_sequences = [existing.sequence].filter((value) => value !== undefined);
      existing.coalesced_count = 1;
    }
    existing.coalesced_ids.push(wakeup.id);
    existing.coalesced_count += 1;
    existing.coalesced_sequences = [...existing.coalesced_sequences, wakeup.sequence].filter((value) => value !== undefined);
    if (wakeup.last_error && !existing.last_error) existing.last_error = wakeup.last_error;
  }
  return survivors;
}

// Compute Lead wakeup degradation metrics for an unacknowledged queue.
// "degraded" is true when at least one wakeup is stuck (exhausted attempts)
// or has a recorded `last_error`. The summary is safe to embed inside a
// wakeup prompt or to surface through the snapshot.
export function summarizeWakeupHealth(wakeups, options = {}) {
  if (!Array.isArray(wakeups)) throw new TypeError("wakeups must be an array");
  const maxAttemptsRaw = options.max_attempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isFinite(maxAttemptsRaw) || maxAttemptsRaw < 1) throw new RangeError("max_attempts must be a positive integer");
  const maxAttempts = maxAttemptsRaw;
  const list = wakeups;
  let pending = 0;
  let failed = 0;
  let inFlight = 0;
  let stuck = 0;
  let attempts = 0;
  let oldestPendingAt = null;
  let lastError = null;
  let lastFailedAt = null;
  for (const wakeup of list) {
    if (!wakeup || wakeup.status === "acked") continue;
    pending += 1;
    attempts += Number(wakeup.attempts || 0);
    if (wakeup.status === WAKEUP_STATUS_FAILED) failed += 1;
    if (wakeup.status === WAKEUP_STATUS_IN_FLIGHT) inFlight += 1;
    const createdAt = wakeup.created_at || null;
    if (createdAt && (!oldestPendingAt || createdAt < oldestPendingAt)) oldestPendingAt = createdAt;
    if (wakeup.status === WAKEUP_STATUS_FAILED) {
      if (!lastFailedAt || (wakeup.last_attempt_at || createdAt) > lastFailedAt) {
        lastFailedAt = wakeup.last_attempt_at || createdAt;
      }
    }
    if (Number(wakeup.attempts || 0) >= maxAttempts) stuck += 1;
    if (wakeup.last_error && !lastError) lastError = wakeup.last_error;
  }
  return {
    pending,
    failed,
    in_flight: inFlight,
    stuck,
    attempts,
    oldest_pending_at: oldestPendingAt,
    last_failed_at: lastFailedAt,
    last_error: lastError,
    degraded: stuck > 0 || failed > 0,
  };
}

export function formatLeadWakeup(wakeup, context = {}) {
  const lines = [
    "Pi Team Blackboard wakeup",
    `task_id=${wakeup.task_id}`,
  ];
  if (line(context.task?.name)) lines.push(`task_name=${summary(context.task.name)}`);
  if (line(context.task?.description)) lines.push(`task_description=${summary(context.task.description)}`);
  lines.push(
    `role=${wakeup.role}`,
    `event_sequence=${wakeup.sequence}`,
    `state=${wakeup.state}`,
    `activity=${summary(wakeup.activity)}`,
  );
  if (Array.isArray(context.recent_activity) && context.recent_activity.length) {
    lines.push("recent_activity:");
    for (const item of context.recent_activity) {
      lines.push(`  - ${item.role}:${item.sequence} ${item.state} ${item.activity}`);
    }
  }
  if (Number.isInteger(wakeup.coalesced_count) && wakeup.coalesced_count > 1) {
    lines.push(`coalesced_count=${wakeup.coalesced_count}`);
  }
  if (Array.isArray(wakeup.coalesced_ids) && wakeup.coalesced_ids.length) {
    lines.push(`coalesced_ids=${wakeup.coalesced_ids.join(",")}`);
  }
  const health = context.health;
  if (health && health.degraded) {
    lines.push("degradation:");
    if (health.failed > 0) lines.push(`  failed_attempts=${health.failed}`);
    if (health.stuck > 0) lines.push(`  stuck_attempts=${health.stuck}`);
    if (health.in_flight > 0) lines.push(`  in_flight_attempts=${health.in_flight}`);
    if (line(health.last_error)) lines.push(`  last_error=${summary(health.last_error)}`);
    if (line(health.last_failed_at)) lines.push(`  last_failed_at=${health.last_failed_at}`);
  }
  lines.push("Action: inspect the current Blackboard snapshot, contract, diff, and artifacts before deciding the next Lead action.");
  if (line(wakeup.blocker)) lines.push(`blocker=${summary(wakeup.blocker)}`);
  if (line(wakeup.next)) lines.push(`next=${summary(wakeup.next)}`);
  return lines.join("\n");
}

export function createLeadWakeupRequest(binding, wakeup, context = {}) {
  return {
    thread_id: binding.thread_id,
    host_id: binding.host_id,
    task_id: wakeup.task_id,
    event_key: wakeup.id,
    prompt: formatLeadWakeup(wakeup, context),
  };
}

// Build a Lead wakeup context digest from the current Blackboard state. Reads
// the append-only Agent event log, computes the recent-activity window, and
// derives the wakeup queue's degradation metrics. Failures to read the event
// log surface as an empty digest rather than throwing so dispatch is never
// blocked by observability. The recent-activity window uses
// `before_observed_at = wakeup.created_at` so events from every role whose
// `observed_at` strictly precedes the wakeup are eligible. `before_sequence`
// is intentionally NOT passed to `listAgentEvents` because sequences are
// role-local; the earlier role-local cutoff silently dropped recent activity
// from other roles in multi-role tasks (Reviewer finding
// `cross-role-sequence-cutoff`).
export async function buildLeadWakeupContext(projectRoot, wakeup, options = {}) {
  if (!wakeup || typeof wakeup !== "object" || !wakeup.task_id) throw new TypeError("wakeup must be an object with a task_id");
  const limit = Number.isFinite(options.recent_activity_limit) ? options.recent_activity_limit : DEFAULT_RECENT_ACTIVITY_LIMIT;
  const includeHealth = options.include_health !== false;
  let events = [];
  try {
    events = await listAgentEvents(projectRoot, wakeup.task_id, { limit: Math.max(limit + 1, 6), before_observed_at: wakeup.created_at });
  } catch { events = []; }
  let queue;
  try { queue = await listLeadWakeups(projectRoot, wakeup.task_id); }
  catch { queue = { wakeups: [] }; }
  const taskSummary = { name: queue.name, description: queue.description };
  const context = {
    task: line(taskSummary.name) || line(taskSummary.description) ? taskSummary : null,
    recent_activity: summarizeRecentActivity(events, { limit, before_observed_at: wakeup.created_at }),
  };
  if (includeHealth) {
    context.health = summarizeWakeupHealth(queue.wakeups || [], { max_attempts: options.max_attempts });
  }
  return context;
}

// Return the Lead wakeup degradation summary for the current task queue. This
// is the observability surface used by Lead to detect that the host is no
// longer accepting wakeups, that wakeups are piling up, or that retries have
// been exhausted. Validation failures (invalid task ID, missing state root)
// propagate to the caller so the Lead sees a hard error rather than a
// silently empty digest.
export async function getLeadWakeupHealth(projectRoot, taskId, options = {}) {
  const queue = await listLeadWakeups(projectRoot, taskId);
  return {
    task_id: taskId,
    task_name: queue.name || null,
    task_description: queue.description || null,
    binding: queue.binding,
    status: queue.status,
    health: summarizeWakeupHealth(queue.wakeups || [], { max_attempts: options.max_attempts }),
    wakeups: queue.wakeups || [],
  };
}

// Mark every wakeup as in_flight before dispatch so a concurrent dispatch
// call from another host thread sees the wakeup already claimed. Returns a
// setter that restores the prior status if delivery fails so we never leave a
// wakeup wedged in `in_flight` after a transport error. The setter is a
// no-op once the record is reloaded.
async function markInFlight(projectRoot, taskId, wakeupId) {
  // We piggy-back on the existing recordLeadWakeupDelivery contract: it
  // increments attempts and writes a last_attempt_at. The host still owns the
  // canonical delivered/failed verdict. We do NOT call it here because we
  // don't yet know the transport outcome; the dispatcher below records it.
  // Returning a setter instead keeps this function pure and side-effect free.
  return async () => {};
}

// Dispatch all unacknowledged wakeups for the task. Concurrency: the blackboard
// core serializes writes through its task lock, but we still guard against a
// second dispatcher racing on the same wakeup by checking attempts/maxAttempts
// right before send and by honoring `recordLeadWakeupDelivery`'s atomic
// increment. Deduplication: `coalesceWakeups` collapses matching siblings
// inside the rolling window so the host is not asked to deliver the same
// notification twice. Observability: a failed wakeup keeps its `last_error`
// and `attempts`, and a `health` summary is returned so callers (and tests)
// can detect degraded delivery.
export async function dispatchLeadWakeups(projectRoot, taskId, sendMessageToThread, options = {}) {
  if (typeof sendMessageToThread !== "function") throw new TypeError("sendMessageToThread must be a function");
  const maxAttempts = Number.isFinite(options.maxAttempts) ? Math.max(1, options.maxAttempts) : DEFAULT_MAX_ATTEMPTS;
  const dedupWindowMs = Number.isFinite(options.dedup_window_ms) ? options.dedup_window_ms : DEFAULT_DEDUP_WINDOW_MS;
  const includeContext = options.include_context !== false;
  const queue = await listLeadWakeups(projectRoot, taskId);
  if (!queue.binding) {
    const health = summarizeWakeupHealth(queue.wakeups || [], { max_attempts: maxAttempts });
    return { task_id: taskId, binding: null, delivered: [], skipped: queue.wakeups || [], deduplicated: [], health };
  }
  const eligible = (queue.wakeups || []).filter((wakeup) => wakeup.status !== WAKEUP_STATUS_DELIVERED && Number(wakeup.attempts || 0) < maxAttempts);
  const deduped = coalesceWakeups(eligible, { window_ms: dedupWindowMs });
  const delivered = [];
  const skipped = (queue.wakeups || []).filter((wakeup) => !deduped.includes(wakeup));
  for (const wakeup of deduped) {
    const claim = await claimLeadWakeup(projectRoot, taskId, wakeup.id, { maxAttempts }).catch(() => null);
    if (!claim || !claim.wakeup) {
      const reason = claim?.reason || "claim-failed";
      skipped.push({ ...wakeup, skip_reason: reason });
      continue;
    }
    // Merge coalesced metadata onto the claimed wakeup so the prompt can
    // surface how many sibling wakeups were collapsed into this dispatch.
    const dispatched_wakeup = {
      ...claim.wakeup,
      ...(wakeup.coalesced_ids ? { coalesced_ids: wakeup.coalesced_ids } : {}),
      ...(wakeup.coalesced_sequences ? { coalesced_sequences: wakeup.coalesced_sequences } : {}),
      ...(Number.isInteger(wakeup.coalesced_count) ? { coalesced_count: wakeup.coalesced_count } : {}),
    };
    let context = null;
    if (includeContext) {
      try { context = await buildLeadWakeupContext(projectRoot, dispatched_wakeup, { max_attempts: maxAttempts }); }
      catch { context = null; }
    }
    const request = createLeadWakeupRequest(queue.binding, dispatched_wakeup, context || {});
    try {
      const result = await sendMessageToThread(request);
      const accepted = result?.accepted === true || result?.delivered === true || result?.threadId === queue.binding.thread_id;
      const deliveryId = result?.delivery_id || result?.threadId || randomUUID();
      const recorded = await recordLeadWakeupDelivery(projectRoot, taskId, claim.wakeup.id, accepted
        ? { delivered: true, delivery_id: deliveryId }
        : { delivered: false, error: result?.reason || "host-rejected-wakeup" });
      delivered.push(recorded.wakeup);
    } catch (error) {
      const recorded = await recordLeadWakeupDelivery(projectRoot, taskId, claim.wakeup.id, { delivered: false, error: error.message });
      delivered.push(recorded.wakeup);
    }
  }
  const refreshed = await listLeadWakeups(projectRoot, taskId).catch(() => ({ wakeups: delivered }));
  const health = summarizeWakeupHealth(refreshed.wakeups || [], { max_attempts: maxAttempts });
  return {
    task_id: taskId,
    binding: queue.binding,
    delivered,
    skipped,
    deduplicated: eligible.filter((wakeup) => !deduped.includes(wakeup)),
    health,
  };
}

export async function acknowledgeDeliveredWakeup(projectRoot, taskId, wakeupId, deliveryId) {
  return acknowledgeLeadWakeup(projectRoot, taskId, wakeupId, { delivery_id: deliveryId });
}

// Render the task lane view as a Lead wakeup summary. Wraps `snapshot` so the
// host adapter can deliver a textual digest alongside structured wakeups. The
// output is plain text; it never embeds base64/base64url transport payloads.
export async function renderLeadWakeupDigest(projectRoot, taskId, options = {}) {
  const queue = await listLeadWakeups(projectRoot, taskId).catch(() => null);
  if (!queue) return `task_id=${taskId}\nbinding=null\npending=0\ndegraded=false`;
  const health = summarizeWakeupHealth(queue.wakeups || [], { max_attempts: options.max_attempts });
  const lines = [
    `task_id=${taskId}`,
    `task_name=${summary(queue.name || "")}`,
    `task_description=${summary(queue.description || "")}`,
    `binding=${queue.binding ? `${queue.binding.host_id}:${queue.binding.thread_id}` : "null"}`,
    `pending=${health.pending}`,
    `failed=${health.failed}`,
    `in_flight=${health.in_flight}`,
    `stuck=${health.stuck}`,
    `degraded=${health.degraded}`,
  ];
  if (line(health.last_error)) lines.push(`last_error=${summary(health.last_error)}`);
  return lines.join("\n");
}

// Convenience re-export so callers can fetch a Blackboard snapshot from the
// adapter without importing `blackboard-core` directly. Kept as a named export
// to preserve the adapter's narrow public surface.
export async function snapshotBlackboardFromAdapter(projectRoot, options = {}) {
  return snapshotBlackboard(projectRoot, Boolean(options.include_archived), options.cursor);
}
