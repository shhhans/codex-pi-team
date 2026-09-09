import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { structuredIntercomToolDescription } from "./policy.mjs";
import { createRoleRuntimePolicy } from "./runtime-policy.mjs";

type PeerSession = { id?: string; name?: string };
type IntercomChannel = {
  listSessions: () => Promise<PeerSession[]>;
  publish: (payload: unknown, options?: { audience?: "owner" | "capable"; ownerOnly?: boolean }) => void;
};

const TEAM_TRANSPORT_TYPE = "pi-team-structured-envelope/v1";

function roleForSession(session: PeerSession | undefined, taskId: string | undefined) {
  const identity = [session?.id, session?.name].find(value => typeof value === "string")?.toLowerCase();
  const escapedTask = taskId?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase();
  const match = identity?.match(new RegExp(`^pi-team--${escapedTask}--(lead|researcher|executor|reviewer)--`));
  return match?.[1];
}

export function installRolePolicy(pi: ExtensionAPI, role: string, auditDir?: string) {
  let intercomChannel: IntercomChannel | undefined;
  const policy = createRoleRuntimePolicy(role, {
    auditDir: auditDir ?? process.env.HARNESS_POLICY_AUDIT_DIR,
    replyStoreDir: process.env.HARNESS_REPLY_STORE_DIR,
    lifecycleRoot: process.env.HARNESS_LIFECYCLE_ROOT,
    runId: process.env.HARNESS_RUN_ID,
    planVersion: process.env.HARNESS_PLAN_VERSION,
    memoryPath: process.env.HARNESS_MEMORY_PATH,
    artifactDir: process.env.HARNESS_ARTIFACT_DIR,
    listPeerSessions: async () => intercomChannel ? intercomChannel.listSessions() : [],
    deliverStructuredEnvelope: async ({ target, envelope }: { target: string; envelope: string }) => {
      if (!intercomChannel) return { delivered: false, reason: "peer-discovery-unavailable" };
      try {
        // pi-intercom's capability channel is the underlying transport. The
        // target ID remains inside runtime-only payload metadata and never
        // reaches the role model or the registered tool contract.
        intercomChannel.publish({ type: TEAM_TRANSPORT_TYPE, to_session_id: target, envelope }, { audience: "capable" });
        return { delivered: true };
      } catch {
        return { delivered: false, reason: "transport-unavailable" };
      }
    },
  });
  const receiveTransportEvent = async (event: any) => {
    if (event?.type !== "message" || !event.payload || typeof event.payload !== "object") return;
    const payload = event.payload as { type?: string; to_session_id?: string; message_id?: string; envelope?: string };
    if (payload.type !== TEAM_TRANSPORT_TYPE || payload.to_session_id !== process.env.PI_INTERCOM_SESSION_ID || typeof payload.envelope !== "string") return;
    let sessions: PeerSession[];
    try { sessions = await intercomChannel?.listSessions() ?? []; } catch { return; }
    const sender = roleForSession(sessions.find(session => session.id === event.fromSessionId), process.env.PI_TEAM_TASK_ID);
    if (!sender) return;
    // Project at the transport boundary, before Pi persists a custom session
    // message. Sending an intermediate bodyText entry would keep the raw
    // agent-team/v1 envelope (including base64url body) in the JSONL session
    // transcript even though onContext later hid it from the model.
    const projected = await policy.projectInboundStructuredEnvelope({ sender, text: payload.envelope });
    if (sender === "lead") {
      intercomChannel.publish({
        type: "pi-team-structured-envelope-ack/v1",
        to_session_id: event.fromSessionId,
        message_id: payload.message_id,
        status: projected.accepted ? "accepted" : "refused",
        ...(projected.reason ? { reason: projected.reason } : {}),
      }, { audience: "capable" });
    }
    if (!projected.accepted) return;
    pi.sendMessage(projected.message, { triggerTurn: true, deliverAs: "followUp" });
  };
  const registerIntercomChannel = () => {
    if (intercomChannel) return;
    // The role extension can be evaluated before pi-intercom has installed its
    // registration listener. Retry once the registry and session runtimes are
    // ready; `onReady` is synchronous, so it also prevents duplicate setup.
    (pi.events as any).emit("intercom:extension-register", {
      namespace: "pi-team.runtime-policy",
      ownerEligible: false,
      onEvent: receiveTransportEvent,
      onReady(channel: IntercomChannel) { intercomChannel = channel; },
    });
  };
  // pi-intercom owns its connected client. Registering on its public local
  // extension bus lets this policy resolve a fresh peer roster without opening
  // a second transport connection or exposing transport IDs to the role.
  (pi.events as any).on("intercom:extension-registry-ready", registerIntercomChannel);
  pi.on("session_start", registerIntercomChannel);
  registerIntercomChannel();
  // Pi rejects duplicate tool names across extensions, so the role-visible
  // contract has its own name. The native `intercom` tool remains loaded only
  // to provide the underlying capability channel and is not role-active.
  pi.registerTool({
    name: "pi_team_intercom",
    label: "Pi Team Intercom",
    description: structuredIntercomToolDescription(role, process.env.PI_TEAM_TASK_ID),
    promptSnippet: "Send a validated Pi Team JSON event to a paired role.",
    promptGuidelines: ["Use this tool's JSON contract; never construct transport envelopes."],
    parameters: Type.Object({
      action: Type.Literal("send"),
      to: Type.String(),
      message: Type.String(),
    }, { additionalProperties: false }),
    async execute() {
      // onToolCall has already validated, enveloped, audited, and published
      // the event through the channel. Keeping transport out of this execute
      // function makes it impossible for a role-visible raw tool to bypass
      // the structured policy.
      return { content: [{ type: "text", text: "Pi Team event sent." }], details: { delivered: true } };
    },
  });
  pi.on("tool_call", policy.onToolCall);
  pi.on("tool_result", policy.onToolResult);
  pi.on("context", policy.onContext);
}
