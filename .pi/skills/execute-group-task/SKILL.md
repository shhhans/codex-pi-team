---
name: execute-group-task
description: Plan and implement a group task after exactly one adversarial plan review; deliver local commits for code review.
---
Use team_read to obtain task_id, generation and your open work. Read task.md and group.md. Submit plan.md before production edits; after the one plan-review.md, record concern handling in implementation.md and implement. No second plan review or ACK. Run tests and create a local task-branch commit including evidence; team_submit implementation with round and commit. Stay idle until review. Fix must-fix findings, retain history, and create the next committed delivery. Do not edit submitted plans/reviews, hide failures or merge/push. Use team_send for questions, Coordinator for scope/dependency blockers. Only Lead accepts. Each text message starts with a display-only current_state prefix.

Task identity is injected by runtime. Use the owned work_id; round and review target can derive from that work. Require an ok:true submission receipt. On rejection follow code/next_action and authoritative work; never infer success from prose. Handle incoming steering messages before delivery. Preserve frozen delivery files; independent review evidence goes under review-NN/. An unfinished_work alert requires Coordinator recovery or escalation.
