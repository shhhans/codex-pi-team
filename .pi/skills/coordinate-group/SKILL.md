---
name: coordinate-group
description: Coordinate a persistent module group through file-based planning, one adversarial review, implementation and code review.
---
Read the current task and work with team_read. Maintain group.md and task.md; task submission hands off to Executor. Same-group peers fix and review directly. Resolve blockers in decision-<round>.md (kind resolution), never alter prior evidence. After a passing code review, submit delivery.md. Only Lead accepts and integrates. Cross-group communication is Coordinator-to-Coordinator; report changed external commitments to Lead. All process paths are groups/<group>/tasks/<task>/. Each artifact has one author and is submitted once; implementation.md has versioned snapshots. Use team_send for questions/replies, never as a replacement for team_submit. Save a concise current-task summary before compact when asked. Keep the group alive and idle between events.

Task identity is injected by runtime. Use the owned work_id; round and review target can derive from that work. Require an ok:true submission receipt. On rejection follow code/next_action and authoritative work; never infer success from prose. Handle incoming steering messages before delivery. Preserve frozen delivery files; independent review evidence goes under review-NN/. An unfinished_work alert requires Coordinator recovery or escalation.
