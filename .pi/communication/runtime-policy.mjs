import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyReceiver, parseEnvelope, resolvePeerRole } from "./policy.mjs";
import { sendWithPolicy } from "./send.mjs";
import { PersistentReplyStore } from "./persistent-store.mjs";
import { PersistentRunLifecycle } from "./lifecycle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTIVE_ROLE_NAMES = new Set(["researcher", "executor", "reviewer"]);
const ROLE_NAMES = new Set(["lead", ...ACTIVE_ROLE_NAMES]);
const SAFE_INTERCOM_ACTIONS = new Set(["list", "list-cwd", "status", "pending"]);
const SUPERVISOR_REASONS = new Set(["need_decision", "progress_update", "interview_request"]);

function normalizedRole(value) {
  if (typeof value !== "string") return undefined;
  const role = value.trim().toLowerCase();
  return ROLE_NAMES.has(role) ? role : undefined;
}

export async function appendPolicyAudit(role, event, auditDir = join(HERE, "audit")) {
  await mkdir(auditDir, { recursive: true });
  const record = { at: new Date().toISOString(), role, ...event };
  await appendFile(join(auditDir, `${role}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
}

export function createRoleRuntimePolicy(role, { auditDir, peerSessions = [], replyStoreDir, lifecycleRoot, runId, planVersion, memoryPath, artifactDir } = {}) {
  const normalized = normalizedRole(role);
  if (!normalized || normalized === "lead") throw new Error(`invalid runtime policy role: ${role}`);
  const receiver = new PolicyReceiver(normalized);
  const replyStore = new PersistentReplyStore(replyStoreDir ?? process.env.HARNESS_REPLY_STORE_DIR ?? join(HERE, "reply-store"));
  const lifecycle = new PersistentRunLifecycle(lifecycleRoot ?? process.env.HARNESS_LIFECYCLE_ROOT ?? join(HERE, "lifecycle"));
  const activeRunId = runId ?? process.env.HARNESS_RUN_ID;
  const activePlanVersion = planVersion ?? process.env.HARNESS_PLAN_VERSION;
  const inboundDecisions = new Map();
  let knownPeerSessions = [...peerSessions];
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
    const recipient = normalizedRole(event.input?.to) ?? resolvePeerRole(event.input?.to, event.peerSessions ?? knownPeerSessions);
    let outgoingReply;
    if (typeof event.input?.message === "string") {
      try { outgoingReply = parseEnvelope(event.input.message); } catch { /* sendWithPolicy below provides the authoritative refusal */ }
    }
    const trace = [];
    const leadAudit = { record(entry) { this.entry = entry; return entry; } };
    let result;
    try {
      result = await sendWithPolicy({
        client: { send: async () => ({ delivered: true, policy: "preflight" }) },
        sender: normalized,
        recipient: recipient ?? String(event.input?.to ?? ""),
        trace,
        audit: leadAudit,
        action: "send",
        text: event.input?.message,
      });
    } catch (error) {
      await auditSafely({ direction: "outbound", action, recipient, outcome: "refused", reason: error.message });
      return { block: true, reason: `Agent communication policy refused malformed send: ${error.message}` };
    }
    if (result.delivered !== true) {
      await auditSafely({ direction: "outbound", action, recipient, outcome: "refused", reason: result.reason, trace });
      return { block: true, reason: `Agent communication policy refused ${normalized} -> ${event.input?.to ?? "unknown"}` };
    }
    if (!await auditSafely({ direction: "outbound", action, recipient, outcome: "allowed" })) {
      return { block: true, reason: "Agent communication policy refused send because Lead audit is unavailable" };
    }
    if (outgoingReply?.kind === "reply") await replyStore.write(normalized, outgoingReply.correlationId, outgoingReply.body);
    return undefined;
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
      if (accepted === undefined) {
        const sender = normalizedRole(message.details?.from?.name);
        const text = message.details?.bodyText;
        if (!sender || typeof text !== "string") {
          accepted = false;
          await auditSafely({ direction: "inbound", outcome: "refused", reason: !sender ? "unknown-sender" : "missing-message-body" });
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
            accepted = true;
          }
          const result = parsed && accepted ? { accepted, envelope: parsed } : { accepted };
          const audited = await auditSafely({
            direction: "inbound",
            sender,
            outcome: accepted ? "accepted" : "refused",
            ...(accepted ? { messageId: result.envelope.id, correlationId: result.envelope.correlationId } : { reason: result.reason ?? "duplicate-or-pending" }),
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
