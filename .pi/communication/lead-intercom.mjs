import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import net from "node:net";
import {
  authorizeStructuredEvent,
  formatAuditEvent,
  makeStructuredEnvelope,
  parseEnvelope,
} from "./policy.mjs";

const NAMESPACE = "pi-team.runtime-policy";
const TRANSPORT_TYPE = "pi-team-structured-envelope/v1";
const ACK_TYPE = "pi-team-structured-envelope-ack/v1";

function getAgentDir(env = process.env) {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

function sanitizePipeSegment(value) {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "default";
}

async function brokerTarget(env = process.env) {
  const agentDir = getAgentDir(env);
  const intercomDir = join(agentDir, "intercom");
  const tcp = process.platform === "win32"
    && [env.PI_INTERCOM_TRANSPORT, env.PI_INTERCOM_TCP].some(value => /^(tcp|1|true)$/i.test(String(value ?? "")));
  if (tcp) {
    const endpoint = JSON.parse(await readFile(join(intercomDir, "broker.port.json"), "utf8"));
    if (endpoint?.transport !== "tcp" || endpoint.host !== "127.0.0.1" || !Number.isSafeInteger(endpoint.port) || endpoint.port <= 0 || endpoint.port > 65535 || typeof endpoint.stateId !== "string" || endpoint.stateId.length === 0) {
      throw new Error("invalid intercom TCP endpoint");
    }
    return { host: endpoint.host, port: endpoint.port, stateId: endpoint.stateId };
  }
  return process.platform === "win32"
    ? `\\\\.\\pipe\\pi-intercom-${sanitizePipeSegment(agentDir)}`
    : join(intercomDir, "broker.sock");
}

function writeFrame(socket, value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  socket.write(frame);
}

function frameReader(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (length > 1024 * 1024) throw new Error(`intercom frame too large: ${length}`);
      if (buffer.length < 4 + length) return;
      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(payload.toString("utf8")));
    }
  };
}

export class LeadIntercomClient {
  constructor({ taskId, projectRoot, env = process.env, timeoutMs = 10000 } = {}) {
    this.taskId = taskId;
    this.projectRoot = projectRoot ?? process.cwd();
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.sessionId = null;
    this.pendingLists = new Map();
    this.acks = new Map();
    this.waiters = new Map();
  }

  async connect() {
    if (this.socket) throw new Error("Lead intercom client is already connected");
    const target = await brokerTarget(this.env);
    this.socket = net.connect(target);
    const socket = this.socket;
    socket.on("data", frameReader((message) => this.#onMessage(message)));
    await new Promise((resolveConnection, rejectConnection) => {
      const timer = setTimeout(() => rejectConnection(new Error("intercom registration timeout")), this.timeoutMs);
      const onRegistered = (message) => {
        clearTimeout(timer);
        socket.off("error", onError);
        this.sessionId = message.sessionId;
        resolveConnection();
      };
      const onError = (error) => {
        clearTimeout(timer);
        socket.off("_registered", onRegistered);
        rejectConnection(error);
      };
      socket.once("_registered", onRegistered);
      socket.once("error", onError);
      const now = Date.now();
      writeFrame(socket, {
        type: "register",
        sessionId: `pi-team--${this.taskId}--lead--${randomUUID()}`,
        session: {
          name: `pi-team--${this.taskId}--lead--codex`,
          cwd: this.projectRoot,
          model: "codex-lead",
          pid: process.pid,
          startedAt: now,
          lastActivity: now,
          status: "idle",
          extensions: [{ namespace: NAMESPACE, ownerEligible: false }],
        },
        ...(typeof target === "object" ? { stateId: target.stateId } : {}),
      });
    });
    return this;
  }

  #onMessage(message) {
    if (message?.type === "registered") {
      this.sessionId = message.sessionId;
      this.socket?.emit("_registered", message);
      return;
    }
    if (message?.type === "sessions") {
      const pending = this.pendingLists.get(message.requestId);
      if (pending) {
        this.pendingLists.delete(message.requestId);
        pending.resolve(message.sessions);
      }
      return;
    }
    if (message?.type === "extension_message" && message.namespace === NAMESPACE) {
      const payload = message.payload;
      if (payload?.type !== ACK_TYPE || payload.to_session_id !== this.sessionId || typeof payload.message_id !== "string") return;
      const ack = { status: payload.status, reason: payload.reason };
      this.acks.set(payload.message_id, ack);
      const waiter = this.waiters.get(payload.message_id);
      if (waiter) {
        this.waiters.delete(payload.message_id);
        waiter.resolve(ack);
      }
      return;
    }
    if (message?.type === "error") {
      for (const pending of this.pendingLists.values()) pending.reject(new Error(message.error));
      this.pendingLists.clear();
    }
  }

  async listSessions() {
    if (!this.socket || !this.sessionId) throw new Error("Lead intercom client is not connected");
    const requestId = randomUUID();
    return new Promise((resolveList, rejectList) => {
      const timer = setTimeout(() => {
        this.pendingLists.delete(requestId);
        rejectList(new Error("intercom session discovery timeout"));
      }, this.timeoutMs);
      this.pendingLists.set(requestId, {
        resolve: (sessions) => { clearTimeout(timer); resolveList(sessions); },
        reject: (error) => { clearTimeout(timer); rejectList(error); },
      });
      writeFrame(this.socket, { type: "list", requestId });
    });
  }

  publish(payload) {
    if (!this.socket || !this.sessionId) throw new Error("Lead intercom client is not connected");
    writeFrame(this.socket, { type: "extension_publish", namespace: NAMESPACE, audience: "capable", payload });
    return { accepted: true };
  }

  waitForAck(messageId, { timeoutMs = this.timeoutMs } = {}) {
    const existing = this.acks.get(messageId);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveAck) => {
      const timer = setTimeout(() => {
        this.waiters.delete(messageId);
        resolveAck({ status: "timeout", reason: "executor confirmation timeout" });
      }, timeoutMs);
      this.waiters.set(messageId, {
        resolve: (ack) => { clearTimeout(timer); resolveAck(ack); },
      });
    });
  }

  close() {
    if (!this.socket) return;
    try { writeFrame(this.socket, { type: "unregister" }); } catch { /* socket is already closing */ }
    this.socket.end();
    this.socket.destroy();
    this.socket = null;
    this.sessionId = null;
  }
}

async function auditLead(auditDir, event, envelope) {
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  const row = formatAuditEvent("lead", event.direction, event, envelope);
  await appendFile(join(auditDir, "lead.jsonl"), `${JSON.stringify(row)}\n`, "utf8");
}

function currentExecutor(sessions, taskId) {
  const prefix = `pi-team--${taskId.toLowerCase()}--executor--`;
  const matches = (Array.isArray(sessions) ? sessions : []).filter(session => typeof session?.id === "string" && session.id.toLowerCase().startsWith(prefix));
  if (matches.length === 0) throw new Error(`executor-unavailable:task_id=${taskId}`);
  if (matches.length !== 1) throw new Error(`executor-ambiguous:task_id=${taskId}`);
  return matches[0];
}

export async function sendLeadRequestChanges({
  taskId,
  delegationId,
  rejectedCriteria,
  rejectedEvidence,
  requiredCorrection,
  nextArtifact,
  projectRoot,
  auditDir,
  timeoutMs,
  client,
} = {}) {
  const event = {
    type: "LEAD_REQUEST_CHANGES",
    task_id: taskId,
    delegation_id: delegationId,
    rejected_criteria: rejectedCriteria,
    rejected_evidence: rejectedEvidence,
    required_correction: requiredCorrection,
    next_artifact: nextArtifact,
    next_state: "FIX_READY",
  };
  let envelope;
  try {
    if (!authorizeStructuredEvent("lead", "executor", event.type)) throw new Error("lead-to-executor event is not authorized");
    envelope = parseEnvelope(makeStructuredEnvelope(JSON.stringify(event), taskId).envelope);
  } catch (error) {
    await auditLead(auditDir, { direction: "outbound", recipient: "executor", outcome: "refused", reason: error.message });
    return { delivered: false, confirmation: "not-sent", reason: error.message };
  }

  const transport = client ?? new LeadIntercomClient({ taskId, projectRoot, timeoutMs });
  let ownsTransport = !client;
  try {
    if (typeof transport.connect === "function") await transport.connect();
    const target = currentExecutor(await transport.listSessions(), taskId);
    const payload = { type: TRANSPORT_TYPE, to_session_id: target.id, message_id: envelope.id, envelope: makeStructuredEnvelope(JSON.stringify(event), taskId).envelope };
    const published = await transport.publish(payload);
    if (published?.accepted !== true) throw new Error(published?.reason ?? "intercom publish refused");
    const confirmation = typeof transport.waitForAck === "function"
      ? await transport.waitForAck(envelope.id, { timeoutMs })
      : { status: "unavailable", reason: "transport has no confirmation channel" };
    const status = confirmation?.status === "accepted" ? "accepted" : confirmation?.status ?? "unknown";
    await auditLead(auditDir, { direction: "outbound", action: "send", recipient: "executor", outcome: "allowed", messageId: envelope.id, correlationId: envelope.correlationId, delivery: "accepted", confirmation: status }, envelope);
    return { delivered: true, delivery: "accepted", confirmation: status, target: target.id, message_id: envelope.id, ...(confirmation?.reason ? { reason: confirmation.reason } : {}) };
  } catch (error) {
    await auditLead(auditDir, { direction: "outbound", action: "send", recipient: "executor", outcome: "refused", reason: error.message, messageId: envelope.id, correlationId: envelope.correlationId });
    return { delivered: false, confirmation: "not-sent", reason: error.message, message_id: envelope.id };
  } finally {
    if (ownsTransport && typeof transport.close === "function") transport.close();
  }
}
