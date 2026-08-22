import { createRoleRuntimePolicy } from "../.pi/communication/runtime-policy.mjs";
import { makeEnvelope, newRequestId } from "../.pi/communication/policy.mjs";

const [directory, mode, id = newRequestId()] = process.argv.slice(2);
const policy = createRoleRuntimePolicy("architect", { replyStoreDir: directory });
const text = makeEnvelope({ id, kind: "request", subject: "replay", body: "multi\nline ✓" });
const result = await policy.receiveAndReplay({ sender: "researcher", text }, async envelope => ({ correlationId: envelope.id, body: "reply for " + envelope.body }));
process.stdout.write(JSON.stringify({ mode, id, result }));
