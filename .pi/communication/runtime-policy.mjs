import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PolicyReceiver,
  makeStructuredEnvelope,
  parseEnvelope,
  resolvePeerRole,
  resolveTeamPeerRole,
  validateResearchBody,
  authorizeResearchDelegation,
  summarizeEnvelopeForAgent,
  formatAuditEvent,
  RESEARCH_MESSAGE_TYPES,
  ROLES,
  BOUNDED_PEERS,
} from "./policy.mjs";
import { sendWithPolicy, classifyClientResult } from "./send.mjs";
import { PersistentReplyStore } from "./persistent-store.mjs";
import { PersistentRunLifecycle } from "./lifecycle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTIVE_ROLE_NAMES = new Set(["researcher", "executor", "reviewer"]);
const ROLE_NAMES = new Set(["lead", ...ACTIVE_ROLE_NAMES]);
const SAFE_INTERCOM_ACTIONS = new Set(["list", "list-cwd", "status", "pending"]);
const SUPERVISOR_REASONS = new Set(["need_decision", "progress_update", "interview_request"]);
// Issue #11 — typed stale-session diagnostic constants. The agent-facing
// reason strings include the missing task/role/launch-id and the recovery hint
// (call intercom list-cwd then re-send). The constants are exported via the
// audit reason field; the agent prompt and skill teach the diagnostic shape.
const STALE_SESSION_PREFIX = "stale-session:role=";
const PEER_WRONG_ROLE_PREFIX = "peer_wrong_role:sender=";
const PEER_WRONG_TASK_PREFIX = "peer_wrong_task:role=";

function normalizedRole(value) {
  if (typeof value !== "string") return undefined;
  const role = value.trim().toLowerCase();
  return ROLE_NAMES.has(role) ? role : undefined;
}

function resolveCurrentPeerSession(sessions, taskId, role) {
  if (!Array.isArray(sessions) || typeof taskId !== "string") return { ok: false, reason: "peer-discovery-unavailable" };
  const prefix = `pi-team--${taskId.toLowerCase()}--${role}--`;
  const matches = sessions.filter(session => {
    if (!session || typeof session.id !== "string") return false;
    // pi-intercom exposes the canonical task/role/launch identity as `id`.
    // `name` is only a display alias (for example `pi-team--TASK--reviewer`)
    // and omits the launch-id, so it cannot be the sole authorization key.
    const identities = [session.id, session.name]
      .filter((value) => typeof value === "string")
      .map((value) => value.toLowerCase());
    return identities.some((identity) => identity.startsWith(prefix));
  });
  if (matches.length === 0) return { ok: false, reason: `peer-unavailable:role=${role}:task_id=${taskId}` };
  if (matches.length !== 1) return { ok: false, reason: `peer-ambiguous:role=${role}:task_id=${taskId}` };
  return { ok: true, session: matches[0] };
}

// Issue #11 — appendPolicyAudit now uses formatAuditEvent (from policy.mjs)
// so that every audit row carries the structured envelope fields (kind,
// subject, references, body_summary, body_fingerprint, body_length) instead
// of the envelope text or the base64 body. The wire envelope is unchanged;
// only the audit row shape gains redacted fields. Existing callers that pass
// only event-level fields (direction, action, recipient, outcome, reason,
// messageId, correlationId, trace) keep their existing schema. To attach the
// envelope to the audit row, callers pass `{ ..., envelope: parsedEnvelope }`
// on the event; the helper strips `envelope` before serializing (it is only
// the source for redaction, not a serialized field).
export async function appendPolicyAudit(role, event, auditDir = join(HERE, "audit")) {
  await mkdir(auditDir, { recursive: true });
  if (!event || typeof event !== "object") {
    const record = formatAuditEvent(role, undefined, {}, null);
    await appendFile(join(auditDir, `${role}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
    return;
  }
  const envelope = event.envelope ?? null;
  const cleaned = { ...event };
  delete cleaned.envelope;
  const record = formatAuditEvent(role, cleaned.direction, cleaned, envelope);
  await appendFile(join(auditDir, `${role}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
}

export function createRoleRuntimePolicy(role, { auditDir, peerSessions = [], listPeerSessions, replyStoreDir, lifecycleRoot, runId, planVersion, memoryPath, artifactDir, client } = {}) {
  const normalized = normalizedRole(role);
  if (!normalized || normalized === "lead") throw new Error(`invalid runtime policy role: ${role}`);
  const receiver = new PolicyReceiver(normalized);
  const replyStore = new PersistentReplyStore(replyStoreDir ?? process.env.HARNESS_REPLY_STORE_DIR ?? join(HERE, "reply-store"));
  const lifecycle = new PersistentRunLifecycle(lifecycleRoot ?? process.env.HARNESS_LIFECYCLE_ROOT ?? join(HERE, "lifecycle"));
  const activeRunId = runId ?? process.env.HARNESS_RUN_ID;
  const activePlanVersion = planVersion ?? process.env.HARNESS_PLAN_VERSION;
  const inboundDecisions = new Map();
  let knownPeerSessions = [...peerSessions];
  const livePeerSessions = listPeerSessions ?? (async () => knownPeerSessions.length > 0 ? knownPeerSessions : [...ACTIVE_ROLE_NAMES].map(roleName => ({
    id: `test-${roleName}`,
    name: `pi-team--${process.env.PI_TEAM_TASK_ID ?? "TEST"}--${roleName}--test`,
  })));
  // Issue #11 — caller-injected client hook for the runtime policy. The hook
  // must implement `{ send: async (recipient, options) => ({ delivered,
  // reason?, id?, ... }) }`; the runtime policy never inspects the hook's
  // implementation, only its return shape (same as the npm `pi-intercom`
  // extension's `client.send`). The default hook returns `{ delivered: true,
  // policy: "preflight" }` so production callers see the existing behavior
  // unchanged; tests can override the hook to drive the
  // `classifyDeliveryFailure` paths (peer_wrong_role, peer_wrong_task,
  // stale-session) and assert the audit row + agent-facing reason shapes.
  const sendClient = client ?? { send: async () => ({ delivered: true, policy: "preflight" }) };
  const audit = (event) => appendPolicyAudit(normalized, event, auditDir);
  const auditSafely = async (event) => {
    try { await audit(event); return true; }
    catch { return false; }
  };

  async function onToolCall(event) {
    if (event.toolName === "contact_supervisor") {
      const reason = event.input?.reason;
      if (!SUPERVISOR_REASONS.has(reason)) {
        await auditSafely({ direction: "supervisor", outcome: "refused", reason: "reason-not-allowed" });
        return { block: true, reason: `${normalized} may not use contact_supervisor with reason=${reason ?? "missing"}` };
      }
      await auditSafely({ direction: "supervisor", outcome: "allowed", reason });
      return undefined;
    }
    if (event.toolName !== "intercom") return undefined;
    const action = event.input?.action;
    if (SAFE_INTERCOM_ACTIONS.has(action)) return undefined;
    if (action !== "send") {
      await auditSafely({ direction: "outbound", action, outcome: "refused", reason: "async-send-only" });
      return { block: true, reason: "Agent peer communication permits asynchronous intercom send only; ask/reply/cancel are not peer-task controls" };
    }
    const requestedRole = typeof event.input?.to === "string" ? event.input.to.trim().toLowerCase() : "";
    if (!ACTIVE_ROLE_NAMES.has(requestedRole)) {
      await auditSafely({ direction: "outbound", action, outcome: "refused", reason: "structured-recipient-must-be-role" });
      return { block: true, reason: "Pi Team intercom send requires a peer role name, never a session or launch ID" };
    }
    let structured;
    try { structured = makeStructuredEnvelope(event.input?.message, process.env.PI_TEAM_TASK_ID); }
    catch (error) {
      await auditSafely({ direction: "outbound", action, recipient: requestedRole, outcome: "refused", reason: error.message });
      return { block: true, reason: `Pi Team intercom send refused: ${error.message}` };
    }
    let sessions;
    try { sessions = await livePeerSessions(); }
    catch {
      await auditSafely({ direction: "outbound", action, recipient: requestedRole, outcome: "refused", reason: "peer-discovery-unavailable" });
      return { block: true, reason: "Pi Team intercom send refused: peer discovery is unavailable" };
    }
    const peer = resolveCurrentPeerSession(sessions, process.env.PI_TEAM_TASK_ID, requestedRole);
    if (!peer.ok) {
      await auditSafely({ direction: "outbound", action, recipient: requestedRole, outcome: "refused", reason: peer.reason });
      return { block: true, reason: `Pi Team intercom send refused: ${peer.reason}` };
    }
    const recipient = requestedRole;
    const target = peer.session.id;
    // Mutating the call input is intentional: the model supplies only its
    // role-level JSON event, while the native intercom tool receives the
    // resolved opaque session ID and the canonical wire envelope.
    event.input.to = target;
    event.input.message = structured.envelope;
    const outgoingReply = parseEnvelope(structured.envelope);
    // Issue #3 — body-level gate for RESEARCH_* messages. The validator runs
    // after parseEnvelope and only when the body decodes to a JSON object whose
    // `type` is in RESEARCH_MESSAGE_TYPES. Non-research messages pass through
    // untouched, so the existing communication-policy tests continue to pass.
    const researchGate = researchBodyGate(outgoingReply, { sender: normalized, recipient });
    if (researchGate && !researchGate.ok) {
      await auditSafely({ direction: "outbound", action, recipient, outcome: "refused", reason: researchGate.reason, envelope: outgoingReply });
      return { block: true, reason: `Agent communication policy refused ${normalized} -> ${event.input?.to ?? "unknown"}: ${researchGate.reason}` };
    }
    const trace = [];
    const leadAudit = { record(entry) { this.entry = entry; return entry; } };
    let result;
    try {
      result = await sendWithPolicy({
        client: sendClient,
        sender: normalized,
        recipient: recipient ?? String(event.input?.to ?? ""),
        trace,
        audit: leadAudit,
        action: "send",
        text: event.input?.message,
      });
    } catch (error) {
      await auditSafely({ direction: "outbound", action, recipient, outcome: "refused", reason: error.message, envelope: outgoingReply });
      return { block: true, reason: `Agent communication policy refused malformed send: ${error.message}` };
    }
    if (result.delivered !== true) {
      // Issue #11 — same-task paired-peer rediscovery. When the agent's target
      // string parses as a valid same-task team peer (e.g. `pi-team--<task>--
      // <role>--<launch-id>`) but the transport reports `delivered: false`, the
      // runtime must distinguish: (a) the target session is stale (replaceable
      // via `intercom list-cwd`); (b) the target resolves to a different task
      // (`peer_wrong_task`); (c) the target resolves to a role outside the
      // sender's bounded peer set (`peer_wrong_role`). All three keep the
      // existing ACL refusal surface intact — the runtime never silently
      // redelivers to a different task or a different role. Cross-task
      // rediscovery is always refused at `authorizeResearchDelegation` /
      // `resolveTeamPeerRole`; the diagnostic is only additive.
      const targetAsString = typeof target === "string" ? target : String(event.input?.to ?? "");
      const sameTaskTarget = parseSameTaskTeamPeer(targetAsString, process.env.PI_TEAM_TASK_ID);
      const isStaleSession = result.policy === "stale-session" || (typeof result.reason === "string" && /no-such-session|disconnected|not-delivered/i.test(result.reason));
      const typed = classifyDeliveryFailure({ sender: normalized, target: targetAsString, sameTaskTarget, isStaleSession });
      if (typed) {
        await auditSafely({ direction: "outbound", action, recipient: typed.auditRecipient ?? recipient, outcome: "refused", reason: typed.reason, envelope: outgoingReply });
        return { block: true, reason: typed.agentReason };
      }
      await auditSafely({ direction: "outbound", action, recipient, outcome: "refused", reason: result.reason, trace, envelope: outgoingReply });
      return { block: true, reason: `Agent communication policy refused ${normalized} -> ${event.input?.to ?? "unknown"}` };
    }
    // Issue #11 — the audit row for an allowed send carries the redacted
    // envelope summary instead of the envelope text. The agent's next turn
    // observes the audit's structured fields only; the base64 body never
    // appears in the audit or in any agent-facing context.
    const audited = await auditSafely({ direction: "outbound", action, recipient, outcome: "allowed", envelope: outgoingReply });
    if (!audited) {
      return { block: true, reason: "Agent communication policy refused send because Lead audit is unavailable" };
    }
    if (outgoingReply?.kind === "reply") await replyStore.write(normalized, outgoingReply.correlationId, outgoingReply.body);
    return undefined;
  }

  // Issue #11 — classifyDeliveryFailure returns a typed diagnostic when the
  // delivery failure can be unambiguously attributed to a stale same-task
  // peer, a wrong-role peer, or a wrong-task peer. Returns undefined for
  // generic delivery failures (the caller falls back to the opaque refusal
  // surface).
  //
  // Inputs:
  //   sender: the runtime role ("executor", "researcher", "reviewer")
  //   target: the raw target string the agent passed (e.g. "pi-team--ISSUE-011--researcher--abc")
  //   sameTaskTarget: parsed { taskId, role, launchId } if the target is a
  //     valid `pi-team--<task-id>--<role>[--<launch-id>]` shape; undefined
  //     otherwise. The parser is conservative: it never returns a result
  //     when the prefix, role, or task-id is malformed.
  //   isStaleSession: true when sendWithPolicy classified the result as a
  //     stale-session failure (sentinel reason or `policy: "stale-session"`)
  //
  // Return shape:
  //   { reason, agentReason, auditRecipient? }
  //   reason: audit row reason (≤ 240 chars, kebab-friendly, machine-greppable)
  //   agentReason: human-readable reason returned in the tool block message
  //     (includes the recovery hint: call intercom list-cwd, then re-send to
  //     the current paired-role peer)
  //   auditRecipient: the resolved role name (so the audit row's recipient
  //     field carries the role, not the raw target string with launch-id)
  function classifyDeliveryFailure({ sender, target, sameTaskTarget, isStaleSession }) {
    if (!sameTaskTarget) return undefined;
    const expectedTaskId = process.env.PI_TEAM_TASK_ID;
    // Cross-task rediscovery: the target's task prefix differs from the
    // sender's task. This is the existing cross-task refusal, restated under
    // the typed surface so the agent's recovery loop stays consistent. The
    // reason preserves the original task-id case (matching the casing the
    // agent typed) so the audit row's reason field is greppable.
    if (expectedTaskId && sameTaskTarget.taskId && sameTaskTarget.taskId.toLowerCase() !== expectedTaskId.toLowerCase()) {
      const displayedTaskId = sameTaskTarget.taskIdOriginal ?? sameTaskTarget.taskId;
      const reason = `${PEER_WRONG_TASK_PREFIX}${sameTaskTarget.role}:expected_task_id=${expectedTaskId}:actual_task_id=${displayedTaskId}`;
      return {
        reason,
        agentReason: `Agent communication policy refused cross-task peer rediscovery: target task=${displayedTaskId} != sender task=${expectedTaskId}; call intercom list-cwd and pick a same-task paired-role peer (never retry a cross-task launch-id)`,
        auditRecipient: sameTaskTarget.role,
      };
    }
    // Wrong-role: the target's role is not in the sender's bounded peer set.
    // This preserves the existing BOUNDED_PEERS ACL — the runtime never
    // accepts an out-of-set recipient even after a stale session is
    // rediscovered.
    const allowed = BOUNDED_PEERS.get(sender);
    if (!allowed || !allowed.has(sameTaskTarget.role)) {
      const reason = `${PEER_WRONG_ROLE_PREFIX}${sender}:role=${sameTaskTarget.role}`;
      return {
        reason,
        agentReason: `Agent communication policy refused ${sender} -> ${sameTaskTarget.role}: sender's bounded peer set does not include ${sameTaskTarget.role}; call intercom list-cwd and pick a same-task paired-role peer`,
        auditRecipient: sameTaskTarget.role,
      };
    }
    // Same-task, in-set role, but the send failed and the failure signature
    // matches the stale-session sentinel list. This is the typed
    // `stale-session` diagnostic: the agent must rediscovery via list-cwd.
    if (isStaleSession) {
      const displayedLaunchId = sameTaskTarget.launchId ?? "?";
      const reason = `${STALE_SESSION_PREFIX}${sameTaskTarget.role}:task_id=${expectedTaskId ?? "?"}:launch_id=${displayedLaunchId}:retry=list-cwd`;
      return {
        reason,
        agentReason: `Agent communication policy detected stale session for ${sameTaskTarget.role} on task ${expectedTaskId ?? "?"} (launch_id=${displayedLaunchId}); call intercom list-cwd and re-send to the current same-task paired ${sameTaskTarget.role} peer`,
        auditRecipient: sameTaskTarget.role,
      };
    }
    return undefined;
  }

  // Issue #11 — parseSameTaskTeamPeer parses a target string and returns
  // { taskId, role, launchId } when the string matches the canonical
  // `pi-team--<task-id>--<role>[--<launch-id>]` shape with a known role
  // name. Returns undefined when any field is malformed. The parser is
  // intentionally permissive about the launch-id segment (kebab-case,
  // alphanumerics, UUIDs all allowed) because the launch-id is informational
  // and varies across resume / restart / crash cycles.
  function parseSameTaskTeamPeer(target, currentTaskId) {
    if (typeof target !== "string") return undefined;
    const trimmed = target.trim();
    const normalized = trimmed.toLowerCase();
    const prefix = `pi-team--`;
    if (!normalized.startsWith(prefix)) return undefined;
    const restOriginal = trimmed.slice(prefix.length);
    const restNormalized = normalized.slice(prefix.length);
    const partsOriginal = restOriginal.split("--");
    const partsNormalized = restNormalized.split("--");
    if (partsNormalized.length < 2) return undefined;
    // Preserve original case for the audit reason; lowercase for ACL checks.
    const taskIdOriginal = partsOriginal[0];
    const taskId = partsNormalized[0];
    const role = partsNormalized[1];
    const launchIdOriginal = partsOriginal.length >= 3 ? partsOriginal.slice(2).join("--") : undefined;
    if (!taskId || !role) return undefined;
    if (!ROLES.includes(role)) return undefined;
    if (currentTaskId && taskId.toLowerCase() !== currentTaskId.toLowerCase()) {
      // Even when the task differs, return the parsed shape so the caller can
      // produce a typed `peer_wrong_task` diagnostic instead of a generic
      // refusal. The caller is responsible for choosing the diagnostic. The
      // original-case taskId is preserved so the audit row's reason field is
      // greppable against the agent's input.
      return { taskId, taskIdOriginal, role, launchId: launchIdOriginal, mismatchedTask: true };
    }
    return { taskId, taskIdOriginal, role, launchId: launchIdOriginal, mismatchedTask: false };
  }

  // Issue #3 — body-level gate. Returns { ok: true } when the envelope is not
  // a RESEARCH_* message (pass-through) or when the body validates cleanly.
  // Returns { ok: false, reason: "<audit-reason>" } when a RESEARCH_* body
  // fails authorizeResearchDelegation or validateResearchBody. Non-research
  // messages always pass through (they are governed by the existing
  // authorizePeer + sendWithPolicy envelope checks).
  function researchBodyGate(envelope, { sender, recipient }) {
    if (!envelope || typeof envelope.body !== "string") return { ok: true };
    let body;
    try { body = JSON.parse(envelope.body); }
    catch { return { ok: true }; }
    if (!body || typeof body !== "object" || typeof body.type !== "string") return { ok: true };
    if (!RESEARCH_MESSAGE_TYPES.has(body.type)) return { ok: true };
    if (!recipient) return { ok: false, reason: `research-recipient-unresolved:${body.type}` };
    if (sender === "executor" && recipient !== "researcher") {
      return { ok: false, reason: `research-recipient-mismatch:${body.type}:executor-must-target-researcher` };
    }
    if (sender === "researcher" && recipient !== "executor") {
      return { ok: false, reason: `research-recipient-mismatch:${body.type}:researcher-must-target-executor` };
    }
    const delegation = authorizeResearchDelegation(body, {
      taskId: process.env.PI_TEAM_TASK_ID,
      allowedDelegations: parseAllowedDelegations(process.env.PI_TEAM_ALLOWED_DELEGATIONS),
    });
    if (!delegation.ok) return { ok: false, reason: delegation.reason };
    const schema = validateResearchBody(body.type, body);
    if (!schema.ok) return { ok: false, reason: `research-schema-invalid:${body.type}:${schema.reason_code}:${schema.detail}` };
    return { ok: true };
  }

  function parseAllowedDelegations(raw) {
    if (typeof raw !== "string" || raw.length === 0) return [];
    return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  function onToolResult(event) {
    if (event?.toolName !== "intercom") return;
    const action = event.input?.action;
    if (action !== "list" && action !== "list-cwd") return;
    const sessions = event.sessions ?? event.result?.details?.sessions ?? event.result?.sessions;
    if (Array.isArray(sessions)) knownPeerSessions = sessions;
  }

  async function onContext(event, ctx) {
    const kept = [];
    let changed = false;
    for (const message of event.messages) {
      if (message.role === "custom" && message.customType === "scope_change") {
        const details = message.details ?? {};
        if (activeRunId && details.newPlanVersion && activePlanVersion) {
          await lifecycle.markStale(activeRunId, {
            newPlanVersion: details.newPlanVersion,
            partialArtifacts: Array.isArray(details.partialArtifacts) ? details.partialArtifacts : [],
            reason: details.reason ?? "scope-change",
          });
          await auditSafely({ direction: "lifecycle", outcome: "stale-restart", runId: activeRunId, oldPlanVersion: activePlanVersion, newPlanVersion: details.newPlanVersion });
        }
        changed = true;
        continue;
      }
      if (message.role !== "custom" || message.customType !== "intercom_message") {
        kept.push(message);
        continue;
      }
      const transportId = message.details?.message?.id;
      const decisionKey = typeof transportId === "string" ? transportId : message;
      let accepted = inboundDecisions.get(decisionKey);
      let inboundReason;
      if (accepted === undefined) {
        const sender = normalizedRole(message.details?.from?.name);
        const text = message.details?.bodyText;
        if (!sender || typeof text !== "string") {
          accepted = false;
          inboundReason = !sender ? "unknown-sender" : "missing-message-body";
          await auditSafely({ direction: "inbound", outcome: "refused", reason: inboundReason });
        } else {
          let parsed;
          try { parsed = parseEnvelope(text); } catch { parsed = undefined; }
          // Authorization MUST precede every reply-store side effect
          // (read/reserve/write) so an unauthorized sender-to-recipient pair
          // never triggers a persistent lookup or creates a pending record
          // that could collide with a later legitimate send.
          const authorization = receiver.receive({ sender, text });
          if (!authorization.accepted) {
            accepted = false;
            inboundReason = authorization.reason ?? "duplicate-or-pending";
          } else {
            // Authorized: look up any prior completed reply for replay only.
            // No "pending" reservation is written on accept; duplicates within
            // the window are deduped by PolicyReceiver's in-memory DedupStore.
            const previous = parsed ? await replyStore.read(normalized, parsed.id) : undefined;
            if (previous?.status === "completed") {
              kept.push({ ...message, customType: "intercom_replay", details: { ...message.details, bodyText: `REPLAY-OF:${parsed.id}\n${previous.reply}` } });
              changed = true;
              continue;
            }
            // Issue #3 — body-level gate for inbound RESEARCH_* messages. A
            // structurally invalid RESEARCH_RESULT or RESEARCH_BLOCKED arriving
            // from the paired Researcher must be filtered without affecting the
            // legitimate in-flight request. Non-research messages pass through.
            const inboundGate = researchBodyGate(parsed, { sender, recipient: normalized });
            if (!inboundGate.ok) {
              accepted = false;
              inboundReason = inboundGate.reason;
            } else {
              accepted = true;
            }
          }
          const audited = await auditSafely({
            direction: "inbound",
            sender,
            outcome: accepted ? "accepted" : "refused",
            ...(accepted && parsed ? { messageId: parsed.id, correlationId: parsed.correlationId } : { reason: inboundReason ?? "duplicate-or-pending" }),
            envelope: parsed ?? null,
          });
          if (!audited) accepted = false;
        }
        inboundDecisions.set(decisionKey, accepted);
      }
      if (accepted) kept.push(message);
    }
    // Rejection must not abort an in-flight legitimate task. The policy removes
    // the untrusted message from model context; transport/session side effects
    // are outside this hook's guarantee.
    return !changed && kept.length === event.messages.length ? undefined : { messages: kept };
  }

  async function receiveAndReplay({ sender, text, expiresAt }, produceReply) {
    let parsed;
    try { parsed = parseEnvelope(text, expiresAt === undefined ? {} : { expiresAt }); }
    catch (error) { return { accepted: false, reason: error.message }; }
    if (replyStore) {
      const previous = await replyStore.read(normalized, parsed.id);
      if (previous) return { accepted: false, duplicate: true, replay: previous.reply, envelope: parsed };
    }
    const accepted = receiver.receive({ sender, text, expiresAt });
    if (!accepted.accepted) return { accepted: false, reason: accepted.reason };
    if (!replyStore) return { accepted: true, envelope: accepted.envelope, reply: await produceReply(accepted.envelope) };
    const reply = await produceReply(accepted.envelope);
    await replyStore.write(normalized, accepted.envelope.id, reply);
    return { accepted: true, envelope: accepted.envelope, reply };
  }

  return { onToolCall, onToolResult, onContext, receiveAndReplay };
}
