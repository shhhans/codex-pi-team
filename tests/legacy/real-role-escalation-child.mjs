import { spawn } from "node:child_process";
import { IntercomClient } from "../.pi/npm/node_modules/pi-intercom/broker/client.ts";
import { join } from "node:path";

const cli = "C:/Users/Hans/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
const root = process.env.PI_CODING_AGENT_DIR;
const roles = [
  ["architect", "progress_update"],
  ["researcher", "progress_update"],
  ["critic", "need_decision"],
  ["reviewer", "need_decision"],
];

const lead = new IntercomClient();
const received = [];
process.stderr.write("lead-connect\n");
for (let attempt = 0; ; attempt++) {
  try {
    await lead.connect({ name: "lead", cwd: process.cwd(), model: "codex-lead", pid: process.pid, startedAt: Date.now(), lastActivity: Date.now() }, "lead-real-test");
    break;
  } catch (error) {
    if (attempt >= 100) throw error;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
process.stderr.write("lead-connected\n");
process.stderr.write(`lead-session-${lead.sessionId}\n`);
lead.on("message", async (from, message) => {
  received.push({ from: from.name, text: message.content.text, replyTo: message.replyTo });
  if (message.expectsReply) await lead.send(from.id, { text: "Lead acknowledged", replyTo: message.id });
});

for (const [role, reason] of roles) {
  process.stderr.write(`spawn-${role}\n`);
  const message = `AT-${role}-escalation UUID=123e4567-e89b-12d3-a456-426614174000 correlation=123e4567-e89b-12d3-a456-426614174000`;
  const prompt = `Call contact_supervisor exactly once with reason ${reason} and message ${JSON.stringify(message)}, then stop.`;
  const env = {
    ...process.env,
    PI_SUBAGENT_ORCHESTRATOR_TARGET: "lead-real-test",
    PI_SUBAGENT_ORCHESTRATOR_SESSION_ID: "lead-real-test",
    PI_SUBAGENT_RUN_ID: `run-${role}`,
    PI_SUBAGENT_CHILD_AGENT: role,
    PI_SUBAGENT_CHILD_INDEX: "0",
    PI_SUBAGENT_INTERCOM_SESSION_NAME: role,
  };
  if (root) env.PI_CODING_AGENT_DIR = root;
  const child = spawn(process.execPath, [cli, "--provider", "minimax-cn", "--model", "MiniMax-M3", "--thinking", "off", "--no-session", "--mode", "json", "--print", "--tools", "contact_supervisor,intercom", "--extension", ".pi/npm/node_modules/pi-intercom/index.ts", "--extension", `.pi/communication/extensions/${role}.ts`, "--system-prompt", `You are the ${role} role. Follow the requested tool call exactly.`, prompt], { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.on("spawn", () => process.stderr.write(`child-spawned-${role}-${child.pid}\n`));
  child.on("error", error => process.stderr.write(`child-error-${role}-${error.message}\n`));
  child.on("exit", code => process.stderr.write(`child-exit-${role}-${code}\n`));
  const before = received.length;
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + Number(process.env.HARNESS_REAL_ROLE_TIMEOUT_MS ?? 30000);
    const poll = setInterval(() => {
      if (received.length > before) {
        process.stderr.write(`received-${role}\n`);
        clearInterval(poll); child.kill(); resolve(); return;
      }
      if (Date.now() >= deadline) {
        clearInterval(poll); child.kill(); reject(new Error(`${role} real role session timed out\n${stderr}\n${stdout}`));
      }
    }, 100);
    child.on("error", reject);
  });
}

await new Promise(resolve => setTimeout(resolve, 300));
await lead.disconnect();
process.stdout.write(JSON.stringify({ received }));
