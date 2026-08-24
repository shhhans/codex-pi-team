import assert from "node:assert/strict";
import { IntercomClient } from "../.pi/npm/node_modules/pi-intercom/broker/client.ts";
import { createRoleRuntimePolicy } from "../.pi/communication/runtime-policy.mjs";
import { makeEnvelope, newRequestId } from "../.pi/communication/policy.mjs";

async function connect(client, name) {
  for (let i = 0; ; i++) {
    try { await client.connect({ name, cwd: process.cwd(), model: name, pid: process.pid, startedAt: Date.now(), lastActivity: Date.now() }, `${name}-e2e`); return; }
    catch (error) { if (i > 100) throw error; await new Promise(resolve => setTimeout(resolve, 30)); }
  }
}

const lead = new IntercomClient();
const senders = new Map();
const received = [];
await connect(lead, "lead");
lead.on("message", async (from, message) => {
  received.push({ from: from.name, text: message.content.text });
  if (message.expectsReply) await lead.send(from.id, { text: "Lead decision acknowledged", replyTo: message.id });
});
try {
  for (const role of ["architect", "researcher", "critic", "reviewer"]) {
    const client = new IntercomClient(); await connect(client, role); senders.set(role, client);
  }
  for (const [role, reason] of [["architect", "progress_update"], ["researcher", "progress_update"], ["critic", "need_decision"], ["reviewer", "need_decision"]]) {
    const policy = createRoleRuntimePolicy(role, { auditDir: process.env.HARNESS_POLICY_AUDIT_DIR });
    assert.equal((await policy.onToolCall({ toolName: "contact_supervisor", input: { reason, message: `${role} mirror/escalation` } })), undefined);
    const id = newRequestId();
    const result = await senders.get(role).send("lead", { text: makeEnvelope({ id, kind: reason === "need_decision" ? "request" : "progress", subject: `${role}-lead`, body: `${reason}:${role}` }), expectsReply: reason === "need_decision" });
    assert.equal(result.delivered, true);
  }
  const critic = createRoleRuntimePolicy("critic");
  assert.equal((await critic.onToolCall({ toolName: "contact_supervisor", input: { reason: "progress_update", message: "routine" } })).block, true);
  const architect = createRoleRuntimePolicy("architect");
  assert.equal((await architect.onToolCall({ toolName: "intercom", input: { action: "send", to: "lead", message: makeEnvelope({ id: newRequestId(), kind: "request", subject: "wrong-path", body: "x" }) } })).block, true);
  const deadline = Date.now() + 3000;
  while (received.length < 4 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(new Set(received.map(item => item.from)), new Set(["architect", "researcher", "critic", "reviewer"]));
  process.stdout.write(JSON.stringify({ leadMirror: true, criticEscalation: true, reviewerEscalation: true, received: received.length }));
} finally {
  for (const client of senders.values()) await client.disconnect().catch(() => {});
  await lead.disconnect().catch(() => {});
}
