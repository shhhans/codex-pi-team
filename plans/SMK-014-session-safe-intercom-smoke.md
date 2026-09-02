# SMK-014 — Session-safe Pi Team intercom smoke

```json
{
  "version": 2,
  "task_id": "SMK-014",
  "name": "Session-safe Pi Team intercom handoff",
  "description": "Verify that a real Executor-Reviewer handoff persists only projected structured events, never raw intercom envelopes.",
  "base_ref": "develop",
  "branch": "pi-team/SMK-014-session-safe-intercom-smoke",
  "worktree": "D:/Coding/Harness/Pi-team-SMK-014-session-safe-intercom-smoke",
  "in_scope": ["implementation_notes/SMK-014.md", "reports/SMK-014-review.md"],
  "out_of_scope": ["shell commands", "production code", "test code", "role prompts or skills", "runtime policy", "Blackboard runtime", "npm packages", "remote repositories", "application-layer hashes"],
  "done_criteria": [
    {"id":"C-001","description":"Executor writes its evidence artifact, sends READY_FOR_REVIEW with pi_team_intercom, and reports ready_for_review.","owner":"executor","artifacts":["implementation_notes/SMK-014.md"]},
    {"id":"C-002","description":"Reviewer receives the runtime-projected event, writes its verdict artifact, sends REVIEW_PASS with pi_team_intercom, and reports ready_for_acceptance.","owner":"reviewer","artifacts":["reports/SMK-014-review.md"]},
    {"id":"C-003","description":"Lead verifies both artifacts, both events, and the newly persisted Executor and Reviewer session entries contain no agent-team/v1 header, body_encoding field, or base64url wire body.","owner":"executor","artifacts":["implementation_notes/SMK-014.md","reports/SMK-014-review.md"]}
  ],
  "delegations": [
    {"id":"EXECUTOR-SMK-014","role":"executor","objective":"Do not run shell commands. Write implementation_notes/SMK-014.md containing the exact marker 'executor session-safe intercom evidence ready'. Then use the registered pi_team_intercom tool description, rather than any prompt or task-contract example, to send READY_FOR_REVIEW to the paired Reviewer. Publish ready_for_review through blackboard_update and wait for REVIEW_PASS. Do not inspect, construct, or decode transport data.","artifact_path":"implementation_notes/SMK-014.md","required_capabilities":["read","grep","find","ls","edit","write","pi_team_intercom","blackboard_update"]},
    {"id":"REVIEWER-SMK-014","role":"reviewer","objective":"Do not run shell commands. Wait for READY_FOR_REVIEW. Process only the runtime-projected JSON event; do not inspect, construct, or decode transport data. Read implementation_notes/SMK-014.md, confirm its exact marker, and write reports/SMK-014-review.md recording the received event type and successful marker check. Then use the registered pi_team_intercom tool description to send REVIEW_PASS to the paired Executor and publish ready_for_acceptance through blackboard_update.","artifact_path":"reports/SMK-014-review.md","required_capabilities":["read","grep","find","ls","edit","write","pi_team_intercom","blackboard_update"]}
  ],
  "constraints": ["Use native Windows and pi-team.cmd", "Do not run bash or shell commands", "Do not use report_to_lead", "Do not commit, stash, reset, checkout, rebase, or cleanup", "Only same-task asynchronous pi_team_intercom send is allowed", "The registered pi_team_intercom tool description is the only event-schema authority", "Any raw envelope or base64 decoding behavior fails this smoke"]
}
```
