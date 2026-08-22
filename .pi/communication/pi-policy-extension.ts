import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRoleRuntimePolicy } from "./runtime-policy.mjs";

export function installRolePolicy(pi: ExtensionAPI, role: string, auditDir?: string) {
  const policy = createRoleRuntimePolicy(role, {
    auditDir: auditDir ?? process.env.HARNESS_POLICY_AUDIT_DIR,
    replyStoreDir: process.env.HARNESS_REPLY_STORE_DIR,
    lifecycleRoot: process.env.HARNESS_LIFECYCLE_ROOT,
    runId: process.env.HARNESS_RUN_ID,
    planVersion: process.env.HARNESS_PLAN_VERSION,
    memoryPath: process.env.HARNESS_MEMORY_PATH,
    artifactDir: process.env.HARNESS_ARTIFACT_DIR,
  });
  pi.on("tool_call", policy.onToolCall);
  pi.on("tool_result", policy.onToolResult);
  pi.on("context", policy.onContext);
}
