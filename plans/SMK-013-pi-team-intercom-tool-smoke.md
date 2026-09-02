# SMK-013 — Pi Team intercom tool smoke

```json
{
  "version": 2,
  "task_id": "SMK-013",
  "name": "Pi Team intercom tool handoff",
  "description": "Verify the unique role-visible Pi Team event tool and its runtime-projected peer handoff.",
  "base_ref": "develop",
  "branch": "pi-team/SMK-013-pi-team-intercom-tool-smoke",
  "worktree": "D:/Coding/Harness/Pi-team-SMK-013-pi-team-intercom-tool-smoke",
  "in_scope": ["implementation_notes/SMK-013.md", "reports/SMK-013-review.md"],
  "out_of_scope": ["shell commands", "production code", "test code", "role prompts or skills", "runtime policy", "Blackboard runtime", "npm packages", "remote repositories", "application-layer hashes"],
  "done_criteria": [
    {"id":"C-001","description":"Executor writes its evidence artifact, uses pi_team_intercom to send READY_FOR_REVIEW, and reports ready_for_review.","owner":"executor","artifacts":["implementation_notes/SMK-013.md"]},
    {"id":"C-002","description":"Reviewer receives the projected event, writes its verdict artifact, uses pi_team_intercom to send REVIEW_PASS, and reports ready_for_acceptance.","owner":"reviewer","artifacts":["reports/SMK-013-review.md"]},
    {"id":"C-003","description":"Lead verifies both artifacts, both role events, and that neither role transcript exposes or decodes a wire envelope.","owner":"executor","artifacts":["implementation_notes/SMK-013.md","reports/SMK-013-review.md"]}
  ],
  "delegations": [
    {"id":"EXECUTOR-SMK-013","role":"executor","objective":"Do not run shell commands. Write implementation_notes/SMK-013.md containing the exact marker 'executor pi-team-intercom evidence ready'. Then use the registered pi_team_intercom tool description, rather than any prompt or task-contract example, to send READY_FOR_REVIEW to the paired Reviewer. Publish ready_for_review through blackboard_update and wait for REVIEW_PASS. Do not inspect, construct, or decode any transport representation.","artifact_path":"implementation_notes/SMK-013.md","required_capabilities":["read","grep","find","ls","edit","write","pi_team_intercom","blackboard_update"]},
    {"id":"REVIEWER-SMK-013","role":"reviewer","objective":"Do not run shell commands. Wait for READY_FOR_REVIEW. Process only the runtime-projected JSON event; do not inspect, construct, or decode transport data. Read implementation_notes/SMK-013.md, confirm its exact marker, and write reports/SMK-013-review.md recording the received event type and the successful marker check. Then use the registered pi_team_intercom tool description to send REVIEW_PASS to the paired Executor and publish ready_for_acceptance through blackboard_update.","artifact_path":"reports/SMK-013-review.md","required_capabilities":["read","grep","find","ls","edit","write","pi_team_intercom","blackboard_update"]}
  ],
  "constraints": ["Use native Windows and pi-team.cmd", "Do not run bash or shell commands", "Do not use report_to_lead", "Do not commit, stash, reset, checkout, rebase, or cleanup", "Only same-task asynchronous pi_team_intercom send is allowed", "The registered pi_team_intercom tool description is the only event-schema authority", "Any raw envelope or base64 decoding behavior fails this smoke"]
}
```
