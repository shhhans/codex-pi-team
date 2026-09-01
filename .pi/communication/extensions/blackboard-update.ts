import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { appendAgentEvent } from "../../../plugins/agent-blackboard/server/blackboard-core.mjs";

const states = ["working", "waiting", "blocked", "completed", "ready_for_review", "reviewing", "changes_requested", "ready_for_acceptance"] as const;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "blackboard_update",
    label: "Blackboard Update",
    description: "Publish the current Agent activity to the Lead-owned task Blackboard. blocked, changes_requested, ready_for_review, ready_for_acceptance, and completed enqueue a Lead wakeup when the task has a Lead binding.",
    parameters: Type.Object({
      task_id: Type.String({ maxLength: 128 }),
      state: Type.Union(states.map((state) => Type.Literal(state))),
      activity: Type.String({ maxLength: 240 }),
      blocker: Type.Optional(Type.String({ maxLength: 500 })),
      next: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    async execute(_id, input) {
      const taskId = process.env.PI_TEAM_TASK_ID;
      const role = process.env.PI_TEAM_ROLE;
      const agentId = process.env.PI_TEAM_AGENT_ID;
      const worktree = process.env.PI_TEAM_WORKTREE;
      if (!taskId || !role || !agentId || !worktree) throw new Error("Blackboard runtime identity is not injected");
      if (input.task_id !== taskId) throw new Error("blackboard task_id must match the injected task identity");
      try {
        const result = await appendAgentEvent(process.cwd(), { task_id: taskId, role, agent_id: agentId, worktree }, input);
        return { content: [{ type: "text", text: `blackboard updated ${taskId}: ${input.state}; current Lead task: ${result.task.name} — ${result.task.description}` }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Blackboard update failed; pause at the safe boundary and notify Lead: ${message}`);
      }
    },
  });
}
