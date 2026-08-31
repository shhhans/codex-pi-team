---
name: blackboard-lead
description: "Manage the local Agent Blackboard as the Lead: create and update task scope, watch Agent events, inspect snapshots, accept, archive, and render the task-lane view. Use when the Lead needs observable Pi Agent activity without turning the blackboard into a control bus."
---

# Blackboard Lead

Use the `blackboard_*` MCP tools from the repo-local `agent-blackboard` plugin.
Always pass the absolute project root. The blackboard state is stored at
`<git-common-dir>/harness-blackboard/v1/`, shared by the main worktree and all
Git worktrees.
The plugin package is self-contained: its MCP server loads the packaged
`server/blackboard-core.mjs`, so an installed plugin does not rely on a
repository-relative `.pi/blackboard` file.

## Lead ownership

- Create each task with the Lead-assigned `task_id`, current `name`, and current
  `description`.
- Only the Lead changes `name`, `description`, `status`, and task revisions.
- Treat the task description as a live scope baseline, not as a replacement for
  `goal.md`, ADRs, or the formal task contract.
- Accept only after the ordinary Lead review gate is satisfied; archive only
  after resources are reclaimed. Archiving hides the task by default but keeps
  its history.

After the task is started, register the current Codex Lead thread with
`blackboard_register_lead` using its exact `thread_id` and `host_id`. Critical
Agent states create persistent structured wakeups for that binding. The host
adapter delivers them as concise follow-up prompts and acknowledges them with
`blackboard_ack_lead_wakeup`; a wakeup is only a reminder, not authorization or
acceptance. Unregister the binding after acceptance or reclamation.

## Agent activity

`blackboard_update` is exposed only to Pi roles. It receives the task ID and
activity fields, while role, Agent ID, worktree, sequence, and observed time
come from launcher-injected runtime identity. Critical states also enqueue a
structured Lead reminder. Blackboard remains an observability and reminder
plane, not authorization, completion proof, or a communication receipt.

When calling `blackboard_watch`, retain the returned cursor and pass it to the
next call. A returned event includes the latest Lead task name and description;
compare the Agent action to that current baseline. A timeout means only that no
new Agent event arrived. If the event indicates drift, correct it through the
existing `report_to_lead`/supervisor/intercom path.

## UI

`blackboard_render` returns a small task-lane HTML view. Request PiP when the
host supports it; if the host rejects or does not expose PiP, keep the same view
inline. The UI polls snapshots every two seconds, but the Lead watcher remains
independent of the UI.
