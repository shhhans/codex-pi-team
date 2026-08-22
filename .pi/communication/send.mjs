import { authorizePeer, LeadAudit, parseEnvelope } from "./policy.mjs";

export async function sendWithPolicy({ client, sender, recipient, trace = [], audit = new LeadAudit(), ...options }) {
  if (!authorizePeer(sender, recipient)) {
    trace.push({ event: "refuse-before-intercom", sender, recipient, action: options.action ?? "send" });
    audit.record({ sender, recipient, action: options.action ?? "send" });
    return { delivered: false, policy: "refused", reason: "unauthorized-peer" };
  }
  audit.record({ sender, recipient, action: options.action ?? "send" });
  const { action = "send", ...sendOptions } = options;
  if (action !== "send") throw new Error("only asynchronous send is permitted by this helper");
  if (typeof sendOptions.text !== "string") throw new Error("policy send requires an agent-team/v1 text envelope");
  parseEnvelope(sendOptions.text);
  return client.send(recipient, sendOptions);
}
