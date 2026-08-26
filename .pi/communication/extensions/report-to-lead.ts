import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { appendRoleEvent, registerRoleRuntime } from "../role-events.mjs";

const states = ["working", "waiting", "blocked", "completed", "ready_for_review", "reviewing", "changes_requested", "ready_for_acceptance"] as const;
export default function (pi: ExtensionAPI) {
  const taskId = process.env.PI_TEAM_TASK_ID;
  const role = process.env.PI_TEAM_ROLE;
  const agentId = process.env.PI_TEAM_AGENT_ID;
  const stateRoot = process.env.PI_TEAM_STATE_ROOT;
  const launchId = process.env.PI_TEAM_LAUNCH_ID;
  const intercomId = process.env.PI_INTERCOM_STABLE_ID;
  if (taskId && role && agentId && stateRoot && launchId && intercomId) {
    registerRoleRuntime(stateRoot, { task_id: taskId, role, agent_id: agentId, launch_id: launchId, intercom_id: intercomId, worktree: process.env.PI_TEAM_WORKTREE }).catch(() => undefined);
  }
  pi.registerTool({
    name: "report_to_lead",
    label: "Report to Lead",
    description: "Append a validated status event for the current Pi Team task.",
    parameters: Type.Object({ state: Type.Union(states.map((s) => Type.Literal(s))), activity: Type.String({ maxLength: 4000 }), blocker: Type.Optional(Type.String({ maxLength: 2000 })), next: Type.Optional(Type.String({ maxLength: 2000 })) }),
    async execute(_id, input) {
      if (!taskId || !role || !agentId || !stateRoot) throw new Error("Pi Team identity is not injected");
      await appendRoleEvent(stateRoot, { task_id: taskId, role, agent_id: agentId, worktree: process.env.PI_TEAM_WORKTREE, launch_id: launchId, ...input });
      return { content: [{ type: "text", text: `reported ${input.state} for ${taskId}` }] };
    },
  });
}
