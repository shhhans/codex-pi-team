# Goal

Build a reliable persistent module team with simple responsibilities and durable handoffs. One Coordinator owns communication, one Executor plans/implements and one Validator reviews. Every task has exactly one adversarial plan review before implementation, then as many defect-fix/code-review rounds as needed.

A lost notification, repeated submission or process restart must not lose work or approve the wrong code version. Working text is display only. Process documents are grouped by module/task and preserved in Git. Lead retains final authority. Same-group sessions/worktree survive task completion.

Do not restore formal debate, Blackboard tool/state requirements or autonomous Lead wakeup infrastructure in this version. Evaluate their future value separately using delivery time, manual recovery frequency and escaped defects.
