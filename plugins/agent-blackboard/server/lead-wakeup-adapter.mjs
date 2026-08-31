import { randomUUID } from "node:crypto";
import {
  acknowledgeLeadWakeup,
  listLeadWakeups,
  recordLeadWakeupDelivery,
} from "./blackboard-core.mjs";

function line(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summary(value) {
  const text = line(value) || "";
  if (/^(?:[A-Za-z0-9+/_-]{32,}=*)$/.test(text) || /^eyJ[A-Za-z0-9+/_-]{20,}/.test(text)) return "[transport payload redacted]";
  return text.length <= 160 ? text : `${text.slice(0, 159)}…`;
}

export function formatLeadWakeup(wakeup) {
  const lines = [
    "Pi Team Blackboard wakeup",
    `task_id=${wakeup.task_id}`,
    `role=${wakeup.role}`,
    `event_sequence=${wakeup.sequence}`,
    `state=${wakeup.state}`,
    `activity=${summary(wakeup.activity)}`,
    "Action: inspect the current Blackboard snapshot, contract, diff, and artifacts before deciding the next Lead action.",
  ];
  if (line(wakeup.blocker)) lines.push(`blocker=${summary(wakeup.blocker)}`);
  if (line(wakeup.next)) lines.push(`next=${summary(wakeup.next)}`);
  return lines.join("\n");
}

export function createLeadWakeupRequest(binding, wakeup) {
  return {
    thread_id: binding.thread_id,
    host_id: binding.host_id,
    task_id: wakeup.task_id,
    event_key: wakeup.id,
    prompt: formatLeadWakeup(wakeup),
  };
}

export async function dispatchLeadWakeups(projectRoot, taskId, sendMessageToThread, { maxAttempts = 3 } = {}) {
  if (typeof sendMessageToThread !== "function") throw new TypeError("sendMessageToThread must be a function");
  const queue = await listLeadWakeups(projectRoot, taskId);
  if (!queue.binding) return { task_id: taskId, binding: null, delivered: [], skipped: queue.wakeups };
  const delivered = [];
  const skipped = [];
  for (const wakeup of queue.wakeups) {
    if (wakeup.status === "delivered" || Number(wakeup.attempts || 0) >= maxAttempts) {
      skipped.push(wakeup);
      continue;
    }
    const request = createLeadWakeupRequest(queue.binding, wakeup);
    try {
      const result = await sendMessageToThread(request);
      const accepted = result?.accepted === true || result?.delivered === true || result?.threadId === queue.binding.thread_id;
      const deliveryId = result?.delivery_id || result?.threadId || randomUUID();
      const recorded = await recordLeadWakeupDelivery(projectRoot, taskId, wakeup.id, accepted
        ? { delivered: true, delivery_id: deliveryId }
        : { delivered: false, error: result?.reason || "host-rejected-wakeup" });
      delivered.push(recorded.wakeup);
    } catch (error) {
      const recorded = await recordLeadWakeupDelivery(projectRoot, taskId, wakeup.id, { delivered: false, error: error.message });
      delivered.push(recorded.wakeup);
    }
  }
  return { task_id: taskId, binding: queue.binding, delivered, skipped };
}

export async function acknowledgeDeliveredWakeup(projectRoot, taskId, wakeupId, deliveryId) {
  return acknowledgeLeadWakeup(projectRoot, taskId, wakeupId, { delivery_id: deliveryId });
}
