import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installRolePolicy } from "../pi-policy-extension.ts";
export default function (pi: ExtensionAPI) { installRolePolicy(pi, "engineer"); }
