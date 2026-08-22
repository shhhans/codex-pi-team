import { randomUUID } from "node:crypto";

export const ROLES = ["lead", "researcher", "architect", "engineer", "critic", "reviewer"];
export const BOUNDED_PEERS = new Map([
  ["researcher", new Set(["architect"])],
  ["architect", new Set(["researcher", "critic"])],
  ["critic", new Set(["architect"])],
  ["engineer", new Set()],
  ["reviewer", new Set()],
  ["lead", new Set()],
]);
export const KINDS = new Set(["request", "reply", "error", "progress"]);
export const SUPERVISOR_REASONS = new Set(["need_decision", "progress_update", "interview_request"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newRequestId() { return randomUUID(); }

export function authorizePeer(sender, recipient) {
  return BOUNDED_PEERS.get(sender)?.has(recipient) === true;
}

export function authorizeSupervisorEscalation(sender, reason) {
  return (sender === "critic" || sender === "reviewer") && reason === "need_decision";
}

export function makeEnvelope({ id, correlationId = id, kind, subject, body, planVersion, artifactPath }) {
  if (!UUID.test(id) || !UUID.test(correlationId)) throw new Error("invalid UUID");
  if (!KINDS.has(kind)) throw new Error("invalid kind");
  if (!subject || subject.length > 80 || !body) throw new Error("invalid message text");
  const encodedBody = Buffer.from(String(body), "utf8").toString("base64url");
  return [
    "agent-team/v1",
    `id: ${id}`,
    `correlation_id: ${correlationId}`,
    `kind: ${kind}`,
    "body_encoding: base64url",
    `references: ${JSON.stringify({ ...(planVersion ? { plan_version: planVersion } : {}), ...(artifactPath ? { artifact_path: artifactPath } : {}) })}`,
    `subject: ${subject}`,
    `body: ${encodedBody}`,
  ].join("\n");
}

export function parseEnvelope(text, { expiresAt } = {}) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(": ");
    if (i <= 0) { if (line === "agent-team/v1") fields[line] = ""; else throw new Error("malformed envelope"); }
    else { const key = line.slice(0, i); if (fields[key] !== undefined) throw new Error("duplicate envelope field"); fields[key] = line.slice(i + 2); }
  }
  if (fields["agent-team/v1"] !== "" || !fields.id || !fields.correlation_id) throw new Error("malformed envelope");
  if (!UUID.test(fields.id) || !UUID.test(fields.correlation_id) || !KINDS.has(fields.kind)) throw new Error("invalid envelope fields");
  const allowed = new Set(["agent-team/v1", "id", "correlation_id", "kind", "body_encoding", "references", "subject", "body"]);
  if (Object.keys(fields).some(key => !allowed.has(key))) throw new Error("unknown envelope field");
  if (fields.body_encoding !== "base64url") throw new Error("unsupported body encoding");
  if (!fields.references) throw new Error("missing references");
  try { JSON.parse(fields.references); } catch { throw new Error("invalid references"); }
  if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) throw new Error("expired message");
  if (!fields.subject || fields.subject.length > 80 || !fields.body) throw new Error("invalid message body");
  let body;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(fields.body)) throw new Error("invalid base64url body");
    body = Buffer.from(fields.body, "base64url").toString("utf8");
    if (Buffer.from(body, "utf8").toString("base64url") !== fields.body) throw new Error("non-canonical base64url body");
  } catch { throw new Error("invalid body encoding"); }
  if (!body) throw new Error("invalid message body");
  return { id: fields.id, correlationId: fields.correlation_id, kind: fields.kind, subject: fields.subject, body };
}

export function resolvePeerRole(target, sessions = []) {
  if (typeof target !== "string") return undefined;
  const needle = target.trim().toLowerCase();
  if (ROLES.includes(needle) && sessions.length === 0) return needle;
  const exactIds = sessions.filter(session => typeof session?.id === "string" && session.id.toLowerCase() === needle);
  if (exactIds.length === 1) {
    const name = typeof exactIds[0].name === "string" ? exactIds[0].name.toLowerCase() : "";
    return ROLES.includes(name) ? name : undefined;
  }
  const matches = sessions.filter(session => {
    const id = typeof session?.id === "string" ? session.id.toLowerCase() : "";
    const name = typeof session?.name === "string" ? session.name.toLowerCase() : "";
    return id === needle || name === needle;
  });
  if (matches.length !== 1) return undefined;
  const name = typeof matches[0].name === "string" ? matches[0].name.toLowerCase() : "";
  return ROLES.includes(name) ? name : undefined;
}

export class DedupStore {
  constructor(windowMs = 60 * 60 * 1000) { this.windowMs = windowMs; this.seen = new Map(); }
  accept(id, recipient, now = Date.now()) {
    const key = `${id}\0${recipient}`;
    const previous = this.seen.get(key);
    if (previous !== undefined && now - previous < this.windowMs) return false;
    this.seen.set(key, now);
    for (const [k, t] of this.seen) if (now - t >= this.windowMs) this.seen.delete(k);
    return true;
  }
}

export class MessageQueue {
  constructor() { this.items = []; }
  enqueue(item) {
    if (!item || !UUID.test(item.id) || !item.sender || !item.recipient || !authorizePeer(item.sender, item.recipient)) throw new Error("unauthorized queue item");
    parseEnvelope(item.text, item.expiresAt === undefined ? {} : { expiresAt: item.expiresAt });
    this.items.push(item); return { queued: true, id: item.id };
  }
  drain(recipient) { const out = this.items.filter(x => x.recipient === recipient); this.items = this.items.filter(x => x.recipient !== recipient); return out; }
  get size() { return this.items.length; }
}

export class RunRegistry {
  constructor() { this.runs = new Map(); }
  start(id, planVersion) { const run = { id, planVersion, status: "active", partials: [] }; this.runs.set(id, run); return run; }
  markStale(id, newPlanVersion, partial) { const run = this.runs.get(id); if (!run) throw new Error("unknown run"); run.status = "stale"; if (partial) run.partials.push(partial); return this.start(`${id}:restart:${newPlanVersion}`, newPlanVersion); }
  authoritative(id) { return this.runs.get(id)?.status === "active"; }
  acceptResult(id, planVersion, effect) {
    const run = this.runs.get(id);
    if (!run || run.status !== "active" || run.planVersion !== planVersion) return { accepted: false, effect: null };
    return { accepted: true, effect };
  }
}

export class LeadAudit {
  constructor() { this.events = []; }
  record({ sender, recipient, action }) {
    const allowed = authorizePeer(sender, recipient);
    this.events.push({ sender, recipient, action, allowed });
    return allowed;
  }
}

export class PolicyReceiver {
  constructor(role, dedup = new DedupStore()) { this.role = role; this.dedup = dedup; }
  receive({ sender, text, expiresAt }, sideEffect = () => {}) {
    if (!authorizePeer(sender, this.role)) return { accepted: false, reason: "unauthorized" };
    let envelope;
    try { envelope = parseEnvelope(text, { expiresAt }); } catch (error) { return { accepted: false, reason: error.message }; }
    if (!this.dedup.accept(envelope.id, this.role)) return { accepted: false, reason: "duplicate" };
    sideEffect(envelope);
    return { accepted: true, envelope };
  }
}

export function refusalTrace(sender, recipient, trace = []) {
  if (authorizePeer(sender, recipient)) return { allowed: true, trace };
  trace.push({ event: "refuse-before-intercom", sender, recipient });
  return { allowed: false, trace };
}

export function shouldMirror({ changesDownstream = false, materialRisk = false, invalidatesAssumption = false, cosmeticOnly = false }) {
  return changesDownstream || materialRisk || invalidatesAssumption || !cosmeticOnly;
}

export function leadFallback({ criticAvailable, actionClass }) {
  const blocked = new Set(["security", "irreversible", "publishing", "deployment", "external-user", "billing", "secret", "remote-infrastructure"]);
  if (criticAvailable) return { status: "reviewed" };
  if (blocked.has(actionClass)) return { status: "blocked", marker: "unverified-architecture" };
  return { status: "degraded", marker: "unverified-architecture" };
}
