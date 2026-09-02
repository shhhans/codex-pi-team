import { createHash, randomUUID } from "node:crypto";

export const ROLES = ["lead", "researcher", "executor", "reviewer"];
export const BOUNDED_PEERS = new Map([
  ["researcher", new Set(["executor"])],
  ["executor", new Set(["researcher", "reviewer"])],
  ["reviewer", new Set(["executor"])],
  ["lead", new Set()],
]);
export const ACTIVE_ROLES = new Set(["researcher", "executor", "reviewer"]);
export const LEGACY_ROLES = new Set(["architect", "critic", "engineer"]);
export const KINDS = new Set(["request", "reply", "error", "progress"]);
export const SUPERVISOR_REASONS = new Set(["need_decision", "progress_update", "interview_request"]);

// Issue #3 — bounded Executor→paired-Researcher delegation.
// Same-task research bodies are typed and validated; the bounded peer topology
// above is unchanged. Lead authority over frozen contract, scope, acceptance,
// and reclamation is preserved.
export const RESEARCH_MESSAGE_TYPES = new Set(["RESEARCH_REQUEST", "RESEARCH_RESULT", "RESEARCH_BLOCKED"]);
export const LIFECYCLE_MESSAGE_TYPES = new Set([
  "READY_FOR_REVIEW",
  "FIX_READY",
  "REVIEW_PASS",
  "REVIEW_FAIL",
  "READY_FOR_ACCEPTANCE",
]);
export const STRUCTURED_MESSAGE_TYPES = new Set([...RESEARCH_MESSAGE_TYPES, ...LIFECYCLE_MESSAGE_TYPES]);
export const RESEARCH_BLOCK_REASON_CODES = new Set([
  "out_of_scope",
  "architectural",
  "under_specified",
  "capability_blocked",
  "in_flight_busy",
  "scope_change_invalidated",
  "deadline_unmet",
  "duplicate",
  "no_response_within_window",
]);
// Mirrors tests/team-contract.test.mjs RESEARCHER_TOOLS exactly.
export const RESEARCHER_CAPABILITIES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "write",
  "web_search",
  "fetch_content",
  "get_search_content",
  "source_check",
  "intercom",
  "blackboard_update",
]);
// Architectural verbs used by the pre-flight heuristic in validateResearchBody.
const ARCHITECTURAL_VERB_RE = /^(?:should\s+we|decide\s+between|what\s+convention|naming\s+convention|choose\s+between|pick\s+between|migrate\s+to|replace\s+\w+\s+with|adopt\s+\w+)/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newRequestId() { return randomUUID(); }

export function authorizePeer(sender, recipient) {
  return BOUNDED_PEERS.get(sender)?.has(recipient) === true;
}

export function authorizeSupervisorEscalation(sender, reason) {
  if (!ACTIVE_ROLES.has(sender)) return false;
  return SUPERVISOR_REASONS.has(reason);
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

// The roles submit this JSON event to intercom.  Wire concerns stay here: the
// runtime owns UUID generation, envelope construction, and base64url encoding.
export function makeStructuredEnvelope(text, taskId) {
  const structured = parseStructuredEvent(text, taskId);
  return {
    event: structured.event,
    envelope: makeEnvelope({
      id: randomUUID(),
      correlationId: structured.correlationId,
      kind: structured.kind,
      subject: `${structured.event.type} ${taskId}`,
      body: JSON.stringify(structured.event),
      artifactPath: structured.event.artifact_path,
    }),
  };
}

// Validate and normalize the role-facing event without touching the wire.
// Both outbound construction and inbound projection use this exact gate, so a
// role can only ever observe the same JSON event shape it is allowed to send.
export function parseStructuredEvent(text, taskId) {
  if (typeof text !== "string") throw new Error("structured-message-must-be-json");
  let event;
  try { event = JSON.parse(text); } catch { throw new Error("structured-message-invalid-json"); }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("structured-message-must-be-object");
  if (typeof event.type !== "string" || !STRUCTURED_MESSAGE_TYPES.has(event.type)) throw new Error("structured-message-unknown-type");
  if (typeof taskId !== "string" || event.task_id !== taskId) throw new Error("structured-message-task-id-mismatch");

  let kind;
  let correlationId;
  if (event.type === "RESEARCH_REQUEST") kind = "request";
  else if (event.type === "RESEARCH_RESULT") kind = "reply";
  else if (event.type === "RESEARCH_BLOCKED") kind = "error";
  else kind = "progress";

  if (RESEARCH_MESSAGE_TYPES.has(event.type)) {
    const schema = validateResearchBody(event.type, event);
    if (!schema.ok) throw new Error(`structured-message-schema-invalid:${event.type}:${schema.reason_code}`);
    if (!UUID.test(event.request_id)) throw new Error("structured-message-invalid-request-id");
    correlationId = event.request_id;
  } else {
    validateLifecycleEvent(event);
    correlationId = randomUUID();
  }

  return { event, kind, correlationId };
}

function validateLifecycleEvent(event) {
  const allowed = new Map([
    ["READY_FOR_REVIEW", new Set(["type", "task_id", "delegation_id", "worktree", "implementation_notes_path", "artifact_path"])],
    ["FIX_READY", new Set(["type", "task_id", "delegation_id", "worktree", "implementation_notes_path", "artifact_path"])],
    ["REVIEW_PASS", new Set(["type", "task_id", "delegation_id", "evidence_paths", "artifact_path"])],
    ["REVIEW_FAIL", new Set(["type", "task_id", "delegation_id", "failure_paths", "evidence_paths", "artifact_path"])],
    ["READY_FOR_ACCEPTANCE", new Set(["type", "task_id", "delegation_id", "worktree", "implementation_notes_path", "artifact_path"])],
  ]);
  const known = allowed.get(event.type);
  if (!known || Object.keys(event).some(key => !known.has(key))) throw new Error("structured-message-unknown-field");
  if (event.type === "REVIEW_PASS" || event.type === "REVIEW_FAIL") {
    const paths = event.type === "REVIEW_PASS" ? event.evidence_paths : event.failure_paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.some(path => typeof path !== "string" || !path)) throw new Error("structured-message-invalid-evidence-paths");
    if (event.evidence_paths !== undefined && (!Array.isArray(event.evidence_paths) || event.evidence_paths.some(path => typeof path !== "string" || !path))) throw new Error("structured-message-invalid-evidence-paths");
    return;
  }
  if (typeof event.worktree !== "string" || !event.worktree || (typeof event.implementation_notes_path !== "string" && typeof event.artifact_path !== "string")) {
    throw new Error("structured-message-missing-handoff-reference");
  }
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

export function resolveTeamPeerRole(target, taskId) {
  if (typeof target !== "string" || typeof taskId !== "string") return undefined;
  const prefix = `pi-team--${taskId.toLowerCase()}--`;
  const normalized = target.trim().toLowerCase();
  if (!normalized.startsWith(prefix)) return undefined;
  const role = normalized.slice(prefix.length).split("--", 1)[0];
  return ROLES.includes(role) ? role : undefined;
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

// Issue #11 — agent-facing envelope summary (base64 redaction).
//
// `summarizeEnvelopeForAgent(envelope)` returns a structured projection of a
// parsed envelope so that the runtime policy can write audit rows and emit
// agent-facing diagnostics without exposing the base64 body line. The wire
// envelope itself remains unchanged (same header, same `body_encoding:
// base64url`, same canonical round-trip); only the agent-facing surface is
// redacted.
//
// `formatAuditEvent(role, direction, event, envelope)` wraps the existing
// audit shape and adds the structured fields. The base64 body never crosses
// the audit boundary; agents and Lead observers only see the redacted fields.
//
// Constants:
// - SUMMARY_FRAGMENT_CHARS = 80 — UTF-8 length of the decoded body fragment
//   embedded in the audit row. Small enough that the audit file remains
//   human-readable; large enough that a single-line subject + first sentence
//   of a body fits.
// - SUMMARY_FINGERPRINT_HEX = 16 — number of hex characters of the SHA-256 of
//   the decoded body. Short enough to be useful as a lookup key without
//   becoming a content hash that the contract forbids.
//
// The fingerprint is computed over the decoded application body (UTF-8), not
// over the base64 wire form. Two envelopes with the same decoded body have the
// same fingerprint; two envelopes with different bytes have different
// fingerprints. The fingerprint is NOT a content hash of the wire payload and
// is therefore compatible with the "no application-layer hashes" rule in
// `AGENTS.md` §"Lead-subagent-protocol" and `ADR/0002` §"Execution boundaries".

const SUMMARY_FRAGMENT_CHARS = 80;
const SUMMARY_FINGERPRINT_HEX = 16;

function truncateUtf8(input, maxChars) {
  if (typeof input !== "string") return "";
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

function bodyFingerprint(decodedBody) {
  if (typeof decodedBody !== "string" || decodedBody.length === 0) return "";
  return createHash("sha256").update(Buffer.from(decodedBody, "utf8")).digest("hex").slice(0, SUMMARY_FINGERPRINT_HEX);
}

// `summarizeEnvelopeForAgent(envelope)` returns a structured projection of a
// parsed envelope. The returned object never carries the base64 body itself;
// only the structured wire fields and the three body-summary fields. The
// caller (runtime-policy.mjs onToolCall / onContext / formatAuditEvent) uses
// this projection to populate the audit row.
//
// Input shape (parsed envelope from parseEnvelope): { id, correlationId, kind,
// subject, body, references? } where `references` is the parsed JSON object
// (not present unless the caller decodes it). Output shape:
//   { id, correlationId, kind, subject, references, bodySummary,
//     bodyFingerprint, bodyLength }
// where `bodyLength` is the byte length of the UTF-8 decoded body and
// `references` is the parsed JSON object (or undefined).
//
// If the input is not a valid envelope (missing kind/subject/id), the
// function returns a minimal projection with empty body-summary fields. The
// caller should treat this as "no envelope to summarize" and skip the
// structured fields in the audit row.
export function summarizeEnvelopeForAgent(envelope) {
  if (!envelope || typeof envelope !== "object") return undefined;
  const kind = typeof envelope.kind === "string" ? envelope.kind : "";
  const subject = typeof envelope.subject === "string" ? envelope.subject : "";
  const id = typeof envelope.id === "string" ? envelope.id : "";
  const correlationId = typeof envelope.correlationId === "string" ? envelope.correlationId : "";
  const body = typeof envelope.body === "string" ? envelope.body : "";
  // A genuine parsed envelope carries all of {kind, subject, id,
  // correlationId}. If any are missing, the caller passed a partial object
  // (e.g. an empty record) and the projection is meaningless; the caller
  // should skip the structured fields in the audit row.
  if (!kind || !subject || !id || !correlationId) return undefined;
  const bodyLength = Buffer.byteLength(body, "utf8");
  return {
    id,
    correlationId,
    kind,
    subject,
    references: envelope.references && typeof envelope.references === "object" ? envelope.references : undefined,
    bodySummary: truncateUtf8(body, SUMMARY_FRAGMENT_CHARS),
    bodyFingerprint: bodyFingerprint(body),
    bodyLength,
  };
}

// `formatAuditEvent(role, direction, event, envelope)` builds a redacted audit
// row. The shape is additive to the existing `appendPolicyAudit` row (which is
// `{ at, role, ...event }`); the structured fields are appended only when an
// envelope is provided and parses cleanly. The base64 body never appears in
// the output.
//
// `event` is the existing event payload (e.g. `{ direction: "outbound",
// action: "send", recipient, outcome, reason, messageId?, correlationId?,
// trace? }`). The function never strips existing fields; it only adds the
// redacted envelope fields.
export function formatAuditEvent(role, direction, event, envelope) {
  const record = { at: new Date().toISOString(), role, ...event };
  // Issue #11 — refused events never expose any envelope-derived field
  // (not the truncated body fragment, the fingerprint, the byte length, or
  // the kind/subject/references). This prevents the audit from leaking an
  // unauthorized sender's body bytes even when the runtime has already
  // parsed the envelope for ACL evaluation.
  const outcome = event && typeof event.outcome === "string" ? event.outcome : undefined;
  if (outcome !== "refused") {
    const summary = summarizeEnvelopeForAgent(envelope);
    if (summary) {
      if (summary.kind) record.kind = summary.kind;
      if (summary.subject) record.subject = summary.subject;
      if (summary.references) record.references = summary.references;
      if (summary.bodySummary !== undefined) record.bodySummary = summary.bodySummary;
      if (summary.bodyFingerprint) record.bodyFingerprint = summary.bodyFingerprint;
      record.bodyLength = summary.bodyLength;
    }
  }
  // Strip the envelope source field so it never reaches the serialized row.
  if ("envelope" in record) delete record.envelope;
  return record;
}

// Issue #3 — Executor→paired-Researcher bounded research schema (Issue #3 §3).
// The schema is enforced at the runtime gate (see runtime-policy.mjs onToolCall)
// before the envelope reaches the transport. The validator never touches the
// transport; it only inspects the already-decoded body the sender composed.
//
// Return shape: { ok: true } on success; { ok: false, reason_code, detail }
// on failure. reason_code is always one of RESEARCH_BLOCK_REASON_CODES or
// "schema_invalid" (a structural refusal, not a research-domain refusal).
// detail is a ≤1024 char human-readable explanation.

function stringOrUndefined(value) {
  return typeof value === "string" ? value : undefined;
}

function stringArrayOrUndefined(value) {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((entry) => typeof entry === "string")) return undefined;
  return value;
}

function validateRequestBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, reason_code: "schema_invalid", detail: "body must be a JSON object" };
  }
  if (body.type !== "RESEARCH_REQUEST") {
    return { ok: false, reason_code: "schema_invalid", detail: `type must equal "RESEARCH_REQUEST" (got ${JSON.stringify(body.type)})` };
  }
  const required = ["task_id", "delegation_id", "request_id", "decision_supported", "objective", "allowed_paths", "artifact_path", "required_capabilities", "frozen_contract_version"];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return { ok: false, reason_code: "under_specified", detail: `missing required field: ${field}` };
    }
  }
  if (!UUID.test(body.request_id)) {
    return { ok: false, reason_code: "schema_invalid", detail: "request_id must be a UUID v4" };
  }
  if (typeof body.objective !== "string" || body.objective.length === 0 || body.objective.length > 240) {
    return { ok: false, reason_code: "under_specified", detail: "objective must be a non-empty string ≤240 chars" };
  }
  if (ARCHITECTURAL_VERB_RE.test(body.objective.trim())) {
    return { ok: false, reason_code: "architectural", detail: `objective triggers architectural heuristic: ${body.objective.slice(0, 80)}` };
  }
  if (typeof body.decision_supported !== "string" || body.decision_supported.length === 0) {
    return { ok: false, reason_code: "under_specified", detail: "decision_supported must be a non-empty string" };
  }
  if (!Array.isArray(body.allowed_paths) || body.allowed_paths.length === 0) {
    return { ok: false, reason_code: "under_specified", detail: "allowed_paths must be a non-empty array of strings" };
  }
  if (!body.allowed_paths.every((entry) => typeof entry === "string")) {
    return { ok: false, reason_code: "schema_invalid", detail: "allowed_paths entries must be strings" };
  }
  if (!Array.isArray(body.required_capabilities) || body.required_capabilities.length === 0) {
    return { ok: false, reason_code: "under_specified", detail: "required_capabilities must be a non-empty array of strings" };
  }
  if (!body.required_capabilities.every((entry) => typeof entry === "string")) {
    return { ok: false, reason_code: "schema_invalid", detail: "required_capabilities entries must be strings" };
  }
  for (const cap of body.required_capabilities) {
    if (!RESEARCHER_CAPABILITIES.has(cap)) {
      return { ok: false, reason_code: "capability_blocked", detail: `required_capability ${cap} is outside RESEARCHER_CAPABILITIES` };
    }
  }
  if (typeof body.frozen_contract_version !== "number" || !Number.isInteger(body.frozen_contract_version) || body.frozen_contract_version <= 0) {
    return { ok: false, reason_code: "schema_invalid", detail: "frozen_contract_version must be a positive integer" };
  }
  if (body.deadline_hint !== undefined && typeof body.deadline_hint !== "string") {
    return { ok: false, reason_code: "schema_invalid", detail: "deadline_hint must be a string (ISO 8601) when present" };
  }
  if (body.context_refs !== undefined && !Array.isArray(body.context_refs)) {
    return { ok: false, reason_code: "schema_invalid", detail: "context_refs must be a string[] when present" };
  }
  return { ok: true };
}

function validateResultBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, reason_code: "schema_invalid", detail: "body must be a JSON object" };
  }
  if (body.type !== "RESEARCH_RESULT") {
    return { ok: false, reason_code: "schema_invalid", detail: `type must equal "RESEARCH_RESULT" (got ${JSON.stringify(body.type)})` };
  }
  const required = ["task_id", "delegation_id", "request_id", "artifact_path", "headline", "findings", "confidence", "decision_impact"];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return { ok: false, reason_code: "schema_invalid", detail: `missing required field: ${field}` };
    }
  }
  if (!UUID.test(body.request_id)) {
    return { ok: false, reason_code: "schema_invalid", detail: "request_id must be a UUID v4" };
  }
  if (typeof body.headline !== "string" || body.headline.length === 0 || body.headline.length > 240) {
    return { ok: false, reason_code: "schema_invalid", detail: "headline must be a non-empty string ≤240 chars" };
  }
  if (!Array.isArray(body.findings) || body.findings.length === 0) {
    return { ok: false, reason_code: "schema_invalid", detail: "findings must be a non-empty array" };
  }
  for (const entry of body.findings) {
    if (!entry || typeof entry !== "object") return { ok: false, reason_code: "schema_invalid", detail: "findings entries must be objects" };
    if (typeof entry.claim !== "string" || entry.claim.length === 0) return { ok: false, reason_code: "schema_invalid", detail: "findings[*].claim must be a non-empty string" };
    if (!Array.isArray(entry.sources) || !entry.sources.every((source) => typeof source === "string")) return { ok: false, reason_code: "schema_invalid", detail: "findings[*].sources must be a string[]" };
    if (!["high", "medium", "low"].includes(entry.confidence)) return { ok: false, reason_code: "schema_invalid", detail: "findings[*].confidence must be one of high|medium|low" };
  }
  if (!["high", "medium", "low"].includes(body.confidence)) {
    return { ok: false, reason_code: "schema_invalid", detail: "confidence must be one of high|medium|low" };
  }
  if (typeof body.decision_impact !== "string" || body.decision_impact.length === 0) {
    return { ok: false, reason_code: "schema_invalid", detail: "decision_impact must be a non-empty string" };
  }
  if (body.blocked_reason !== undefined) {
    return { ok: false, reason_code: "schema_invalid", detail: "RESEARCH_RESULT must not carry blocked_reason; use RESEARCH_BLOCKED" };
  }
  if (body.gaps !== undefined && !Array.isArray(body.gaps)) {
    return { ok: false, reason_code: "schema_invalid", detail: "gaps must be a string[] when present" };
  }
  return { ok: true };
}

function validateBlockedBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, reason_code: "schema_invalid", detail: "body must be a JSON object" };
  }
  if (body.type !== "RESEARCH_BLOCKED") {
    return { ok: false, reason_code: "schema_invalid", detail: `type must equal "RESEARCH_BLOCKED" (got ${JSON.stringify(body.type)})` };
  }
  for (const field of ["task_id", "delegation_id", "request_id", "reason_code", "detail"]) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return { ok: false, reason_code: "schema_invalid", detail: `missing required field: ${field}` };
    }
  }
  if (!UUID.test(body.request_id)) {
    return { ok: false, reason_code: "schema_invalid", detail: "request_id must be a UUID v4" };
  }
  if (!RESEARCH_BLOCK_REASON_CODES.has(body.reason_code)) {
    return { ok: false, reason_code: "schema_invalid", detail: `reason_code must be one of ${[...RESEARCH_BLOCK_REASON_CODES].join("|")}` };
  }
  if (typeof body.detail !== "string" || body.detail.length === 0 || body.detail.length > 1024) {
    return { ok: false, reason_code: "schema_invalid", detail: "detail must be a non-empty string ≤1024 chars" };
  }
  if (["architectural", "out_of_scope", "under_specified"].includes(body.reason_code)) {
    if (body.next_decision_needed === undefined || typeof body.next_decision_needed !== "string" || body.next_decision_needed.length === 0 || body.next_decision_needed.length > 240) {
      return { ok: false, reason_code: "schema_invalid", detail: `next_decision_needed is required and must be ≤240 chars when reason_code=${body.reason_code}` };
    }
  }
  if (body.headline !== undefined) {
    return { ok: false, reason_code: "schema_invalid", detail: "RESEARCH_BLOCKED must not carry headline; use detail" };
  }
  return { ok: true };
}

export function validateResearchBody(type, body) {
  if (!RESEARCH_MESSAGE_TYPES.has(type)) {
    return { ok: false, reason_code: "schema_invalid", detail: `unknown research message type ${JSON.stringify(type)}` };
  }
  if (type === "RESEARCH_REQUEST") return validateRequestBody(body);
  if (type === "RESEARCH_RESULT") return validateResultBody(body);
  return validateBlockedBody(body);
}

// Issue #3 §4 — task / scope / pairing identity binding.
// authorizeResearchDelegation runs after the existing authorizePeer +
// resolveTeamPeerRole check. It enforces:
//   1. body.task_id === taskId (cross-task refusal)
//   2. body.delegation_id ∈ allowedDelegations (cross-task refusal)
//   3. request/result artifact_path matches research/<task-id>-<slug>.md;
//      `RESEARCH_BLOCKED` has no artifact by design
//   4. `RESEARCH_REQUEST` required_capabilities is a non-empty subset of
//      RESEARCHER_CAPABILITIES (a result cannot retroactively request tools)
// Returns { ok: true } or { ok: false, reason } where reason is a ≤512 char
// string suitable for an audit row.
export function authorizeResearchDelegation(body, { taskId, allowedDelegations = [] } = {}) {
  const detail = stringOrUndefined(body?.task_id);
  if (!detail) return { ok: false, reason: "research-task-id-missing" };
  if (detail !== taskId) return { ok: false, reason: `research-task-id-mismatch:body=${detail}:expected=${taskId}` };
  const delegationId = stringOrUndefined(body?.delegation_id);
  if (!delegationId) return { ok: false, reason: "research-delegation-id-missing" };
  if (!allowedDelegations.includes(delegationId)) return { ok: false, reason: `research-delegation-id-unknown:${delegationId}` };
  if (body?.type === "RESEARCH_REQUEST") {
    const capabilities = stringArrayOrUndefined(body?.required_capabilities);
    if (!capabilities || capabilities.length === 0) return { ok: false, reason: "research-required-capabilities-missing" };
    for (const cap of capabilities) {
      if (!RESEARCHER_CAPABILITIES.has(cap)) return { ok: false, reason: `research-capability-blocked:${cap}` };
    }
  }
  if (body?.type === "RESEARCH_BLOCKED") return { ok: true };
  const artifactPath = stringOrUndefined(body?.artifact_path);
  if (!artifactPath) return { ok: false, reason: "research-artifact-path-missing" };
  const expectedPrefix = `research/${taskId}-`;
  if (!artifactPath.startsWith(expectedPrefix) || !artifactPath.endsWith(".md")) {
    return { ok: false, reason: `research-artifact-path-malformed:${artifactPath}` };
  }
  const slug = artifactPath.slice(expectedPrefix.length, -".md".length);
  if (!SLUG_RE.test(slug)) {
    return { ok: false, reason: `research-artifact-slug-invalid:${slug}` };
  }
  if (/[a-f0-9]{32,}/i.test(slug)) {
    return { ok: false, reason: `research-artifact-slug-hash:${slug}` };
  }
  return { ok: true };
}
