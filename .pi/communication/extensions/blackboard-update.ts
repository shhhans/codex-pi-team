import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { appendAgentEvent, ROLE_STATES } from "../../../plugins/agent-blackboard/server/blackboard-core.mjs";
import { registerRoleRuntime } from "../role-events.mjs";
import {
  createLifecycleGate,
  readPreviousEvent,
  validateAgentUpdate,
  ROLE_CHECKPOINTS,
} from "../blackboard-protocol.mjs";

const ROLE_STATE_SCHEMAS = (role: string | undefined) => {
  // The Blackboard server is the source of truth for role-scoped states. Do
  // not advertise states that appendAgentEvent will reject for this role.
  if (role && Object.hasOwn(ROLE_STATES, role)) {
    return Array.from(ROLE_STATES[role as keyof typeof ROLE_STATES]).map((state) => Type.Literal(state));
  }
  return [Type.Literal("blocked")];
};

function describeCheckpoints(role: string | undefined): string {
  if (!role || !Object.hasOwn(ROLE_CHECKPOINTS, role)) return "no role checkpoints loaded";
  const map = ROLE_CHECKPOINTS[role as keyof typeof ROLE_CHECKPOINTS];
  return Object.entries(map)
    .map(([name, states]) => `${name}=[${states.join(", ")}]`)
    .join("; ");
}

export default function (pi: ExtensionAPI) {
  const taskId = process.env.PI_TEAM_TASK_ID;
  const role = process.env.PI_TEAM_ROLE;
  const agentId = process.env.PI_TEAM_AGENT_ID;
  const stateRoot = process.env.PI_TEAM_STATE_ROOT;
  const launchId = process.env.PI_TEAM_LAUNCH_ID;
  const intercomId = process.env.PI_INTERCOM_STABLE_ID;
  const stateSchemas = ROLE_STATE_SCHEMAS(role);
  const gate = createLifecycleGate();
  // This extension is present in every active role. It owns runtime readiness
  // now that the retired report_to_lead extension is no longer loaded.
  if (taskId && role && agentId && stateRoot && launchId && intercomId) {
    registerRoleRuntime(stateRoot, { task_id: taskId, role, agent_id: agentId, launch_id: launchId, intercom_id: intercomId, worktree: process.env.PI_TEAM_WORKTREE }).catch(() => undefined);
  }
  const description = `Publish the current Agent activity to the Lead-owned task Blackboard. Lifecycle checkpoints for ${role ?? "this role"}: ${describeCheckpoints(role)}. ` +
    "blocked, changes_requested, ready_for_review, ready_for_acceptance, and completed enqueue a Lead wakeup when the task has a Lead binding. " +
    "activity must describe an observed fact, blocker is required for blocked/changes_requested, next is required for every other non-terminal state, and identical repeats of the previous event are refused.";
  pi.registerTool({
    name: "blackboard_update",
    label: "Blackboard Update",
    description,
    parameters: Type.Object({
      task_id: Type.String({ maxLength: 128 }),
      state: Type.Union(stateSchemas),
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
      const previous = await readPreviousEvent(stateRoot, taskId, role).catch(() => null);
      try {
        validateAgentUpdate(role, previous, input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Blackboard update refused; ${message}`);
      }
      try {
        const result = await appendAgentEvent(process.cwd(), { task_id: taskId, role, agent_id: agentId, worktree }, input);
        gate.markPublished();
        return { content: [{ type: "text", text: `blackboard updated ${taskId}: ${input.state}; current Lead task: ${result.task.name} — ${result.task.description}` }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Blackboard update failed; pause at the safe boundary and notify Lead: ${message}`);
      }
    },
  });

  pi.on("tool_call", async (event) => {
    const result = gate.evaluate(event);
    if (result.block) {
      return { block: true, reason: result.reason };
    }
    return undefined;
  });
}
