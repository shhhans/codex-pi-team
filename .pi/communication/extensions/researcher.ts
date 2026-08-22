import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installRolePolicy } from "../pi-policy-extension.ts";
export default function (pi: ExtensionAPI) { installRolePolicy(pi, "researcher", process.env.HARNESS_POLICY_AUDIT_DIR); }
