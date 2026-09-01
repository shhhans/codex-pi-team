import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRoleRuntimePolicy } from "./runtime-policy.mjs";

export function installRolePolicy(pi: ExtensionAPI, role: string, auditDir?: string) {
  let intercomChannel: { listSessions: () => Promise<unknown[]> } | undefined;
  const registerIntercomChannel = () => {
    if (intercomChannel) return;
    // The role extension can be evaluated before pi-intercom has installed its
    // registration listener. Retry once the registry and session runtimes are
    // ready; `onReady` is synchronous, so it also prevents duplicate setup.
    (pi.events as any).emit("intercom:extension-register", {
      namespace: "pi-team.runtime-policy",
      ownerEligible: false,
      onEvent() {},
      onReady(channel: { listSessions: () => Promise<unknown[]> }) { intercomChannel = channel; },
    });
  };
  // pi-intercom owns its connected client. Registering on its public local
  // extension bus lets this policy resolve a fresh peer roster without opening
  // a second transport connection or exposing transport IDs to the role.
  (pi.events as any).on("intercom:extension-registry-ready", registerIntercomChannel);
  pi.on("session_start", registerIntercomChannel);
  registerIntercomChannel();
  const policy = createRoleRuntimePolicy(role, {
    auditDir: auditDir ?? process.env.HARNESS_POLICY_AUDIT_DIR,
    replyStoreDir: process.env.HARNESS_REPLY_STORE_DIR,
    lifecycleRoot: process.env.HARNESS_LIFECYCLE_ROOT,
    runId: process.env.HARNESS_RUN_ID,
    planVersion: process.env.HARNESS_PLAN_VERSION,
    memoryPath: process.env.HARNESS_MEMORY_PATH,
    artifactDir: process.env.HARNESS_ARTIFACT_DIR,
    listPeerSessions: async () => intercomChannel ? intercomChannel.listSessions() : [],
  });
  pi.on("tool_call", policy.onToolCall);
  pi.on("tool_result", policy.onToolResult);
  pi.on("context", policy.onContext);
}
