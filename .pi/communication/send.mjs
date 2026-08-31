import { authorizePeer, LeadAudit, parseEnvelope } from "./policy.mjs";

// Issue #11 — stale-session sentinel strings. When the npm `pi-intercom`
// transport returns `{ delivered: false, reason: "<sentinel>" }`, the runtime
// treats the failure as a recoverable stale session and surfaces a typed
// diagnostic to the agent. The sentinel list is conservative: only strings
// that strongly indicate "session is unreachable" trigger the diagnostic.
// Generic failures ("internal error", "rate limited", etc.) keep their
// opaque-reason shape so the agent can read the upstream message.
const STALE_SESSION_SENTINELS = new Set([
  "no-such-session",
  "session-not-found",
  "disconnected",
  "not-delivered",
  "no-such-target",
  "session may not exist or has disconnected.",
]);

export function classifyClientResult(result) {
  if (!result || typeof result !== "object") return { kind: "unknown", reason: "client-returned-undefined" };
  if (result.delivered === true) return { kind: "delivered" };
  if (result.delivered === false) {
    const reason = typeof result.reason === "string" ? result.reason.toLowerCase() : "";
    for (const sentinel of STALE_SESSION_SENTINELS) {
      if (reason.includes(sentinel)) return { kind: "stale-session", reason: result.reason };
    }
    return { kind: "delivery-failed", reason: result.reason ?? "delivery-failed" };
  }
  return { kind: "unknown", reason: "client-returned-shape-error" };
}

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
  const raw = await client.send(recipient, sendOptions);
  const classification = classifyClientResult(raw);
  if (classification.kind === "stale-session") {
    return { delivered: false, policy: "stale-session", reason: classification.reason };
  }
  return raw;
}
