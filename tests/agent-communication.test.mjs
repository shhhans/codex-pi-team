import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizePeer, authorizeSupervisorEscalation, DedupStore, LeadAudit, MessageQueue, PolicyReceiver, RunRegistry, leadFallback, makeEnvelope, newRequestId, parseEnvelope, refusalTrace, resolvePeerRole, shouldMirror } from "../.pi/communication/policy.mjs";
import { PersistentReplyStore } from "../.pi/communication/persistent-store.mjs";
import { PersistentRunLifecycle } from "../.pi/communication/lifecycle.mjs";
import { sendWithPolicy } from "../.pi/communication/send.mjs";
import { createRoleRuntimePolicy } from "../.pi/communication/runtime-policy.mjs";
import { discoverAgents } from "../.pi/npm/node_modules/pi-subagents/src/agents/agents.ts";

test("policy keeps topology and refuses unauthorized pairs before intercom", async () => {
  assert.equal(authorizePeer("researcher", "architect"), true);
  assert.equal(authorizePeer("architect", "critic"), true);
  assert.equal(authorizePeer("critic", "engineer"), false);
  assert.equal(resolvePeerRole("architect-session", [{ id: "architect-session", name: "architect" }]), "architect");
  assert.equal(resolvePeerRole("architect", [{ id: "visible-1", name: "architect" }, { id: "visible-2", name: "architect" }]), undefined);
  const refusal = refusalTrace("critic", "engineer");
  assert.equal(refusal.allowed, false);
  assert.deepEqual(refusal.trace[0].event, "refuse-before-intercom");
  assert.equal(refusal.trace.some(x => x.action === "send" || x.action === "ask"), false);
  const trace = []; const audit = new LeadAudit(); const fakeClient = { send: () => { throw new Error("must not call intercom"); } };
  const result = await sendWithPolicy({ client: fakeClient, sender: "critic", recipient: "engineer", trace, audit });
  assert.equal(result.policy, "refused"); assert.equal(trace.length, 1); assert.equal(audit.events[0].allowed, false);
  assert.equal(shouldMirror({ materialRisk: true }), true);
  assert.equal(leadFallback({ criticAvailable: false, actionClass: "billing" }).status, "blocked");
  assert.equal(leadFallback({ criticAvailable: false, actionClass: "docs" }).marker, "unverified-architecture");
  assert.equal(authorizeSupervisorEscalation("critic", "need_decision"), true);
  assert.equal(authorizeSupervisorEscalation("reviewer", "need_decision"), true);
  assert.equal(authorizeSupervisorEscalation("critic", "progress_update"), false);
  const audit2 = new LeadAudit(); assert.equal(audit2.record({ sender: "critic", recipient: "engineer", action: "send" }), false); assert.equal(audit2.events[0].allowed, false);
});

test("role/config smoke and intercom dependency negative control", async () => {
  const settings = await (await import("node:fs/promises")).readFile(".pi/settings.json", "utf8");
  assert.match(settings, /npm:pi-intercom/); assert.match(settings, /npm:pi-subagents/);
  for (const role of ["researcher", "architect", "engineer", "critic", "reviewer"]) {
    const text = await (await import("node:fs/promises")).readFile(`.pi/agents/${role}.md`, "utf8");
    assert.match(text, /Peer policy:/); assert.match(text, /refuse before/i); assert.match(text, new RegExp(`communication/extensions/${role}\\.ts`));
    if (["researcher", "architect", "critic"].includes(role)) assert.match(text, /^tools:.*\bintercom\b/m);
    else assert.doesNotMatch(text, /^tools:.*\bintercom\b/m);
  }
  const discovered = discoverAgents(process.cwd(), "project");
  assert.equal(discovered.agentDiagnostics.length, 0, JSON.stringify(discovered.agentDiagnostics));
  for (const role of ["researcher", "architect", "engineer", "critic", "reviewer"]) {
    const agent = discovered.agents.find(item => item.name === role);
    assert.ok(agent, `Pi did not discover ${role}`);
    assert.ok(agent.subagentOnlyExtensions?.some(path => path.replaceAll("\\", "/").endsWith(`communication/extensions/${role}.ts`)));
  }
  const root = await mkdtemp(join(tmpdir(), "harness-no-intercom-"));
  try {
    const child = await runChild(["tests/intercom-child.mjs", "--disabled"], { ...process.env, PI_CODING_AGENT_DIR: root });
    assert.equal(child.code, 0); assert.deepEqual(JSON.parse(child.stdout), { disabled: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real Pi runtime hooks causally gate outbound and inbound communication", async () => {
  const auditDir = await mkdtemp(join(tmpdir(), "harness-policy-audit-"));
  try {
    const researcher = createRoleRuntimePolicy("researcher", { auditDir });
    const id = newRequestId();
    const message = makeEnvelope({ id, kind: "request", subject: "policy", body: "probe" });
    assert.equal(await researcher.onToolCall({ toolName: "intercom", input: { action: "send", to: "architect", message } }), undefined);
    assert.equal((await researcher.onToolCall({ toolName: "intercom", input: { action: "send", to: "critic", message } })).block, true);
    assert.equal((await researcher.onToolCall({ toolName: "intercom", input: { action: "ask", to: "architect", message } })).block, true);
    assert.equal((await researcher.onToolCall({ toolName: "intercom", input: { action: "send", to: "architect", message: "malformed" } })).block, true);
    const unavailableAudit = createRoleRuntimePolicy("researcher", { auditDir: join(auditDir, "not-a-directory") });
    await (await import("node:fs/promises")).writeFile(join(auditDir, "not-a-directory"), "occupied", "utf8");
    assert.equal((await unavailableAudit.onToolCall({ toolName: "intercom", input: { action: "send", to: "architect", message } })).block, true);
    assert.equal((await unavailableAudit.onToolCall({ toolName: "intercom", input: { action: "send", to: "critic", message } })).block, true);
    let unguardedTransportCalls = 0;
    const invokeTransport = async (hook) => {
      const event = { toolName: "intercom", input: { action: "send", to: "critic", message } };
      const gate = hook ? await hook(event) : undefined;
      if (!gate?.block) unguardedTransportCalls++;
    };
    await invokeTransport(researcher.onToolCall);
    assert.equal(unguardedTransportCalls, 0);
    await invokeTransport(undefined);
    assert.equal(unguardedTransportCalls, 1, "negative control must expose the unauthorized transport call when the policy hook is removed");
    const critic = createRoleRuntimePolicy("critic", { auditDir });
    assert.equal((await critic.onToolCall({ toolName: "contact_supervisor", input: { reason: "progress_update" } })).block, true);
    assert.equal(await critic.onToolCall({ toolName: "contact_supervisor", input: { reason: "need_decision" } }), undefined);
    const architectMirror = createRoleRuntimePolicy("architect", { auditDir });
    assert.equal(await architectMirror.onToolCall({ toolName: "contact_supervisor", input: { reason: "progress_update" } }), undefined);
    assert.equal((await architectMirror.onToolCall({ toolName: "intercom", input: { action: "send", to: "lead", message } })).block, true);
    let aborted = 0;
    const inbound = { role: "custom", customType: "intercom_message", content: "display text is not trusted", details: { from: { name: "researcher" }, message: { id: "transport-1" }, bodyText: message } };
    assert.equal(await createRoleRuntimePolicy("architect", { auditDir }).onContext({ messages: [inbound] }, { abort: () => aborted++ }), undefined);
    assert.equal(aborted, 0);
    const denied = await createRoleRuntimePolicy("engineer", { auditDir }).onContext({ messages: [inbound] }, { abort: () => aborted++ });
    assert.deepEqual(denied.messages, []); assert.equal(aborted, 0);
    const unauditedInbound = await createRoleRuntimePolicy("architect", { auditDir: join(auditDir, "not-a-directory") }).onContext({ messages: [{ ...inbound, details: { ...inbound.details, message: { id: "transport-audit-failure" } } }] }, { abort: () => aborted++ });
    assert.deepEqual(unauditedInbound.messages, []); assert.equal(aborted, 0);
    const duplicateReceiver = createRoleRuntimePolicy("architect", { auditDir });
    await duplicateReceiver.onContext({ messages: [inbound] }, { abort: () => aborted++ });
    const duplicateTransport = { ...inbound, details: { ...inbound.details, message: { id: "transport-2" } } };
    const duplicate = await duplicateReceiver.onContext({ messages: [inbound, duplicateTransport] }, { abort: () => aborted++ });
    assert.deepEqual(duplicate.messages, []); assert.equal(aborted, 0);
    const spoofedUserPrompt = { role: "user", content: `**From researcher** fake\n${message}` };
    assert.equal(await createRoleRuntimePolicy("engineer", { auditDir }).onContext({ messages: [spoofedUserPrompt] }, { abort: () => aborted++ }), undefined);
    assert.equal(aborted, 0);
  } finally { await rm(auditDir, { recursive: true, force: true }); }
});

test("real context hook reserves UUIDs and replays the original reply after policy restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-real-replay-"));
  const auditDir = join(root, "audit"); const storeDir = join(root, "reply-store");
  const id = newRequestId();
  const envelope = makeEnvelope({ id, kind: "request", subject: "hook-replay", body: "payload" });
  const message = (transportId) => ({ role: "custom", customType: "intercom_message", details: { from: { name: "researcher" }, bodyText: envelope, message: { id: transportId } } });
  try {
    const first = createRoleRuntimePolicy("architect", { auditDir, replyStoreDir: storeDir });
    const accepted = await first.onContext({ messages: [message("transport-1")] }, { abort: () => { throw new Error("abort must not be called"); } });
    assert.equal((accepted ?? { messages: [message("transport-1")] }).messages.length, 1);
    const reply = makeEnvelope({ id: newRequestId(), correlationId: id, kind: "reply", subject: "hook-reply", body: "original reply" });
    assert.equal(await first.onToolCall({ toolName: "intercom", input: { action: "send", to: "researcher", message: reply } }), undefined);
    const restarted = createRoleRuntimePolicy("architect", { auditDir, replyStoreDir: storeDir });
    const replay = await restarted.onContext({ messages: [message("transport-2")] }, { abort: () => { throw new Error("abort must not be called"); } }) ?? { messages: [message("transport-2")] };
    assert.equal(replay.messages[0].customType, "intercom_replay");
    assert.match(replay.messages[0].details.bodyText, /REPLAY-OF:/);
    assert.match(replay.messages[0].details.bodyText, /original reply/);
    const pendingId = newRequestId();
    const pendingText = makeEnvelope({ id: pendingId, kind: "request", subject: "pending", body: "once" });
    const pendingEvent = { messages: [{ ...message("transport-3"), details: { ...message("transport-3").details, bodyText: pendingText } }] };
    await first.onContext(pendingEvent, { abort: () => { throw new Error("abort must not be called"); } });
    const pendingAfterRestart = await restarted.onContext({ messages: [{ ...message("transport-4"), details: { ...message("transport-4").details, bodyText: pendingText } }] }, { abort: () => { throw new Error("abort must not be called"); } });
    assert.equal(pendingAfterRestart.messages.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real context hook drives stale/restart lifecycle at the scope-change boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-real-lifecycle-"));
  try {
    const lifecycle = new PersistentRunLifecycle(root);
    await lifecycle.start({ runId: "run-live", planVersion: "v1", role: "engineer", memoryPath: join(root, "memory.md"), artifactDir: join(root, "artifacts") });
    const policy = createRoleRuntimePolicy("engineer", { auditDir: join(root, "audit"), lifecycleRoot: root, runId: "run-live", planVersion: "v1" });
    const result = await policy.onContext({ messages: [{ role: "custom", customType: "scope_change", details: { newPlanVersion: "v2", partialArtifacts: [{ name: "partial.md", content: "valid partial" }] } }] }, { abort: () => { throw new Error("scope change must reach safe boundary, not abort"); } });
    assert.equal(result.messages.length, 0);
    assert.equal((await lifecycle.readRun("run-live")).status, "stale");
    assert.equal((await lifecycle.readRun("run-live_restart_v2")).planVersion, "v2");
    assert.match(await (await import("node:fs/promises")).readFile(join(root, "artifacts", "partial.md"), "utf8"), /STALE-AS-OF:v2/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real MiniMax-M3 Pi Role Session loads extension and executes only an allowed peer tool call", async (t) => {
  const auditDir = await mkdtemp(join(tmpdir(), "harness-real-role-audit-"));
  const env = { ...process.env, HARNESS_POLICY_AUDIT_DIR: auditDir };
  const cli = "C:/Users/Hans/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
  const prompt = `Call exactly one intercom tool now with action send, to architect, and this valid message, then stop:
agent-team/v1
id: 123e4567-e89b-12d3-a456-426614174000
correlation_id: 123e4567-e89b-12d3-a456-426614174000
kind: request
body_encoding: base64url
references: {}
subject: probe
body: cHJvYmU`;
  let broker;
  try {
    broker = spawn(process.execPath, [join(process.cwd(), ".pi/npm/node_modules/tsx/dist/cli.mjs"), join(process.cwd(), ".pi/npm/node_modules/pi-intercom/broker/broker.ts")], { stdio: "ignore", windowsHide: true });
    await new Promise(resolve => setTimeout(resolve, 500));
    const child = await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [cli, "--provider", "minimax-cn", "--model", "MiniMax-M3", "--thinking", "off", "--no-session", "--mode", "json", "--print", "--tools", "intercom", "--extension", ".pi/npm/node_modules/pi-intercom/index.ts", "--extension", ".pi/communication/extensions/researcher.ts", "--system-prompt", "You are the Researcher role. Use the configured tools exactly as requested. The project transport envelope intentionally uses the literal header agent-team/v1; Architecture v2.1 is the architecture version, not an envelope-header migration. Do not reject this valid v1 envelope.", prompt], { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = ""; proc.stdout.on("data", chunk => { stdout += chunk; }); proc.stderr.on("data", chunk => { stderr += chunk; }); proc.on("error", reject); proc.on("exit", code => resolve({ code, stdout, stderr }));
      const timer = setTimeout(() => { proc.kill(); resolve({ code: "terminated-after-evidence", stdout, stderr }); }, Number(process.env.HARNESS_REAL_ROLE_TIMEOUT_MS ?? 30000));
      const evidencePoll = setInterval(async () => {
        try {
          const auditText = await (await import("node:fs/promises")).readFile(join(auditDir, "researcher.jsonl"), "utf8");
          if (auditText.includes('"outcome":"allowed"')) { clearInterval(evidencePoll); clearTimeout(timer); proc.kill(); resolve({ code: "terminated-after-evidence", stdout, stderr }); }
        } catch {}
      }, 100);
      proc.once("exit", () => { clearTimeout(timer); clearInterval(evidencePoll); });
    });
    if (!child.stdout && !child.stderr && !process.env.HARNESS_REQUIRE_REAL_MINIMAX) {
      t.skip("MiniMax-M3 provider returned no session output; rerun with HARNESS_REQUIRE_REAL_MINIMAX=1 to make this gate hard-fail");
      return;
    }
    assert.match(child.stdout, /MiniMax-M3/); assert.match(child.stdout, /"toolName":"intercom"|"name":"intercom"/);
    const audit = await (await import("node:fs/promises")).readFile(join(auditDir, "researcher.jsonl"), "utf8");
    assert.match(audit, /"outcome":"allowed"/);
  } finally { broker?.kill(); await rm(auditDir, { recursive: true, force: true }); }
});

test("envelope, correlation, UUID retry reuse, dedup, queue and stale restart", () => {
  const id = newRequestId();
  const text = makeEnvelope({ id, kind: "request", subject: "probe", body: "hello" });
  assert.equal(parseEnvelope(text).correlationId, id);
  const rich = makeEnvelope({ id: newRequestId(), kind: "request", subject: "special", body: "line 1\nline: 2 ✓ % {}" });
  assert.equal(parseEnvelope(rich).body, "line 1\nline: 2 ✓ % {} ".trimEnd());
  assert.throws(() => parseEnvelope(rich.replace("body_encoding: base64url", "body_encoding: broken")), /encoding/);
  assert.throws(() => parseEnvelope(rich + "\nextra: field"), /unknown|malformed/);
  assert.equal(makeEnvelope({ id, kind: "request", subject: "retry", body: "same logical request" }).includes(`id: ${id}`), true);
  const dedup = new DedupStore(100);
  assert.equal(dedup.accept(id, "architect", 0), true);
  assert.equal(dedup.accept(id, "architect", 50), false);
  assert.equal(dedup.accept(id, "architect", 101), true);
  const queue = new MessageQueue(); queue.enqueue({ id, sender: "researcher", recipient: "architect", text }); assert.equal(queue.size, 1); assert.equal(queue.drain("architect").length, 1); assert.equal(queue.size, 0);
  const runs = new RunRegistry(); runs.start("run-1", "v1"); const restart = runs.markStale("run-1", "v2", "partial.md");
  assert.equal(runs.authoritative("run-1"), false); assert.equal(restart.planVersion, "v2"); assert.deepEqual(runs.runs.get("run-1").partials, ["partial.md"]);
  assert.deepEqual(runs.acceptResult("run-1", "v1", "side-effect"), { accepted: false, effect: null });
  assert.throws(() => parseEnvelope(text, { expiresAt: 0 }), /expired/);
  let effects = 0; const receiver = new PolicyReceiver("architect");
  assert.equal(new PolicyReceiver("engineer").receive({ sender: "critic", text }, () => effects++).accepted, false);
  assert.equal(receiver.receive({ sender: "researcher", text: text + "\nunknown: nope" }, () => effects++).accepted, false);
  assert.equal(receiver.receive({ sender: "researcher", text, expiresAt: 0 }, () => effects++).accepted, false);
  assert.equal(receiver.receive({ sender: "researcher", text, expiresAt: Number.NaN }, () => effects++).accepted, false);
  assert.equal(receiver.receive({ sender: "researcher", text, expiresAt: "bad" }, () => effects++).accepted, false);
  assert.equal(receiver.receive({ sender: "researcher", text, expiresAt: Infinity }, () => effects++).accepted, false);
  assert.equal(receiver.receive({ sender: "researcher", text }, () => effects++).accepted, true);
  assert.equal(receiver.receive({ sender: "researcher", text }, () => effects++).accepted, false); assert.equal(effects, 1);
});

test("persistent dedup survives process restart and replays the original reply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-replay-"));
  const id = newRequestId();
  try {
    const first = await runChild(["tests/persistent-replay-child.mjs", directory, "first", id], process.env);
    const second = await runChild(["tests/persistent-replay-child.mjs", directory, "second", id], process.env);
    assert.equal(first.code, 0, first.stderr); assert.equal(second.code, 0, second.stderr);
    const a = JSON.parse(first.stdout); const b = JSON.parse(second.stdout);
    assert.equal(a.result.accepted, true); assert.equal(a.result.reply.body, "reply for multi\nline ✓");
    assert.equal(b.result.duplicate, true); assert.deepEqual(b.result.replay, a.result.reply);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("persistent stale/restart lifecycle preserves partials and rejects stale authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-lifecycle-")); const runId = "run-v1";
  try {
    const first = await runChild(["tests/lifecycle-child.mjs", root, "start", runId, "v1"], process.env);
    const stale = await runChild(["tests/lifecycle-child.mjs", root, "stale", runId, "v2"], process.env);
    const old = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, "runs", "run-v1.json"), "utf8"));
    assert.equal(first.code, 0); assert.equal(stale.code, 0); assert.equal(old.status, "stale"); assert.equal(old.staleAsOf, "v2");
    const staleResult = await runChild(["tests/lifecycle-child.mjs", root, "accept", runId, "v1"], process.env);
    assert.deepEqual(JSON.parse(staleResult.stdout), { accepted: false, authoritative: false, result: null });
    const nextResult = await runChild(["tests/lifecycle-child.mjs", root, "accept", `${runId}:restart:v2`, "v2"], process.env);
    assert.deepEqual(JSON.parse(nextResult.stdout), { accepted: true, authoritative: true, result: { value: "candidate" } });
    const artifact = await (await import("node:fs/promises")).readFile(join(root, "artifacts", "partial.md"), "utf8");
    assert.match(artifact, /STALE-AS-OF:v2/); assert.match(artifact, /valid partial/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function runChild(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), ".pi/npm/node_modules/tsx/dist/cli.mjs"), ...args], { cwd: process.cwd(), env, windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject); child.on("exit", code => resolve({ code, stdout, stderr }));
  });
}

test("pi-intercom empirical discovery, async delivery, queue, correlation and non-blocking send", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-intercom-"));
  const env = { ...process.env, PI_CODING_AGENT_DIR: root, PI_INTERCOM_LIVENESS_INTERVAL_MS: "1000" };
  const broker = spawn(process.execPath, [join(process.cwd(), ".pi/npm/node_modules/tsx/dist/cli.mjs"), join(process.cwd(), ".pi/npm/node_modules/pi-intercom/broker/broker.ts")], { env, stdio: "ignore", windowsHide: true });
  try {
    const child = await runChild(["tests/intercom-child.mjs"], env);
    assert.equal(child.code, 0, child.stderr);
    const evidence = JSON.parse(child.stdout);
    assert.equal(evidence.discovery, true); assert.equal(evidence.requestReply, true); assert.equal(evidence.queue, true); assert.equal(evidence.dedup, true); assert.equal(evidence.independentCompletedBeforeReply, true);
  } finally { broker.kill(); await rm(root, { recursive: true, force: true }); }
});

test("Lead mirror and Critic/Reviewer supervisor escalation reach the Lead route", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-lead-route-"));
  const auditDir = await mkdtemp(join(tmpdir(), "harness-lead-audit-"));
  const env = { ...process.env, PI_CODING_AGENT_DIR: root, HARNESS_POLICY_AUDIT_DIR: auditDir };
  const broker = spawn(process.execPath, [join(process.cwd(), ".pi/npm/node_modules/tsx/dist/cli.mjs"), join(process.cwd(), ".pi/npm/node_modules/pi-intercom/broker/broker.ts")], { env, stdio: "ignore", windowsHide: true });
  try {
    const child = await runChild(["tests/lead-routing-child.mjs"], env);
    assert.equal(child.code, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), { leadMirror: true, criticEscalation: true, reviewerEscalation: true, received: 4 });
  } finally { broker.kill(); await rm(root, { recursive: true, force: true }); await rm(auditDir, { recursive: true, force: true }); }
});

test("real MiniMax Role Sessions use the contact_supervisor transport to the Lead", async (t) => {
  if (!process.env.HARNESS_RUN_REAL_ESCALATION) {
    t.skip("set HARNESS_RUN_REAL_ESCALATION=1 to run the four real MiniMax Role Sessions");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "harness-real-escalation-"));
  const env = { ...process.env, HARNESS_REAL_ROLE_TIMEOUT_MS: process.env.HARNESS_REAL_ROLE_TIMEOUT_MS ?? "90000" };
  const broker = spawn(process.execPath, [join(process.cwd(), ".pi/npm/node_modules/tsx/dist/cli.mjs"), join(process.cwd(), ".pi/npm/node_modules/pi-intercom/broker/broker.ts")], { env, stdio: "ignore", windowsHide: true });
  try {
    const result = await runChild(["tests/real-role-escalation-child.mjs"], env);
    assert.equal(result.code, 0, result.stderr); const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.received.length, 4);
    assert.ok(evidence.received.every(item => /AT-(architect|researcher|critic|reviewer)-escalation/.test(item.text)));
  } finally { broker.kill(); await rm(root, { recursive: true, force: true }); }
});
