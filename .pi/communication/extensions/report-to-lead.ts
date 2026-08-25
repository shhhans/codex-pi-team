import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const states = ["working", "waiting", "blocked", "completed", "ready_for_review", "reviewing", "changes_requested", "ready_for_acceptance"] as const;
export default function (pi: ExtensionAPI) {
  const taskId = process.env.PI_TEAM_TASK_ID;
  const role = process.env.PI_TEAM_ROLE;
  const agentId = process.env.PI_TEAM_AGENT_ID;
  const stateRoot = process.env.PI_TEAM_STATE_ROOT;
  let sequence = 0;
  pi.registerTool({
    name: "report_to_lead",
    label: "Report to Lead",
    description: "Append a validated status event for the current Pi Team task.",
    parameters: Type.Object({ state: Type.Union(states.map((s) => Type.Literal(s))), activity: Type.String({ maxLength: 4000 }), blocker: Type.Optional(Type.String({ maxLength: 2000 })), next: Type.Optional(Type.String({ maxLength: 2000 })) }),
    async execute(_id, input) {
      if (!taskId || !role || !agentId || !stateRoot) throw new Error("Pi Team identity is not injected");
      const file = join(stateRoot, `${taskId}-${role}.jsonl`); mkdirSync(dirname(file), { recursive: true });
      sequence += 1;
      const event = { version: 1, task_id: taskId, role, agent_id: agentId, worktree: process.env.PI_TEAM_WORKTREE, sequence, at: new Date().toISOString(), ...input };
      appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
      return { content: [{ type: "text", text: `reported ${input.state} for ${taskId}` }] };
    },
  });
}
