import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { IntercomClient } from "../.pi/npm/node_modules/pi-intercom/broker/client.ts";
import { PolicyReceiver, makeEnvelope, newRequestId, parseEnvelope } from "../.pi/communication/policy.mjs";
import { sendWithPolicy } from "../.pi/communication/send.mjs";

async function waitFor(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("timeout");
}

if (process.argv.includes("--disabled")) {
  const client = new IntercomClient();
  await assert.rejects(() => client.connect({ name: "disabled", cwd: process.cwd(), model: "test", pid: process.pid, startedAt: Date.now(), lastActivity: Date.now() }));
  process.stdout.write(JSON.stringify({ disabled: true }));
  process.exit(0);
}

const a = new IntercomClient();
const b = new IntercomClient();
const requests = [];
const replies = [];
const architectReceiver = new PolicyReceiver("architect");
const researcherReceiver = new PolicyReceiver("researcher");
try {
  await waitFor(async () => {
    try {
      await a.connect({ name: "researcher", cwd: process.cwd(), model: "test", pid: process.pid, startedAt: Date.now(), lastActivity: Date.now() }, "researcher-test");
      return true;
    } catch { return false; }
  });
  await b.connect({ name: "architect", cwd: process.cwd(), model: "test", pid: process.pid, startedAt: Date.now(), lastActivity: Date.now() }, "architect-test");
  let originalId;
  b.on("message", (_from, message) => {
    const accepted = architectReceiver.receive({ sender: "researcher", text: message.content.text }, envelope => requests.push(envelope));
    if (accepted.accepted && envelopeKind(accepted.envelope) === "request") {
      setTimeout(() => {
        const replyId = newRequestId();
        void sendWithPolicy({
          client: b,
          sender: "architect",
          recipient: "researcher",
          messageId: replyId,
          text: makeEnvelope({ id: replyId, correlationId: accepted.envelope.id, kind: "reply", subject: "async reply", body: "ack" }),
        });
      }, 200);
    }
  });
  a.on("message", (_from, message) => researcherReceiver.receive({ sender: "architect", text: message.content.text }, envelope => replies.push(envelope)));

  const sessions = await a.listSessions();
  assert.ok(sessions.some(session => session.name === "architect"));
  originalId = newRequestId();
  const started = Date.now();
  const result = await sendWithPolicy({ client: a, sender: "researcher", recipient: "architect", messageId: originalId, text: makeEnvelope({ id: originalId, kind: "request", subject: "async", body: "probe" }) });
  const sendElapsedMs = Date.now() - started;
  assert.equal(result.delivered, true);
  assert.ok(sendElapsedMs < 1000);
  await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
  const independentCompletedBeforeReply = replies.length === 0;
  await waitFor(() => replies.length === 1);
  assert.equal(replies[0].correlationId, originalId);

  const duplicate = await sendWithPolicy({ client: a, sender: "researcher", recipient: "architect", messageId: newRequestId(), retryOf: originalId, text: makeEnvelope({ id: originalId, kind: "request", subject: "async retry", body: "probe" }) });
  assert.equal(duplicate.delivered, true);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(requests.filter(item => item.id === originalId).length, 1);

  await b.disconnect();
  const queuedId = newRequestId();
  const queued = await sendWithPolicy({ client: a, sender: "researcher", recipient: "architect", messageId: queuedId, text: makeEnvelope({ id: queuedId, kind: "progress", subject: "queued", body: "mail" }) });
  assert.equal(queued.delivery, "queued");
  await b.connect({ name: "architect", cwd: process.cwd(), model: "test", pid: process.pid, startedAt: Date.now(), lastActivity: Date.now() }, "architect-test");
  await waitFor(() => requests.some(item => item.id === queuedId));
  process.stdout.write(JSON.stringify({ discovery: true, requestReply: true, queue: true, dedup: true, sendElapsedMs, independentCompletedBeforeReply }));
} finally {
  await a.disconnect().catch(() => {});
  await b.disconnect().catch(() => {});
}

function envelopeKind(envelope) { return envelope.kind; }
