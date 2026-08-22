# Decision 2026-08-21-01 — Agent Team Communication Baseline

- status: accepted
- decision_owner: User
- recorded_by: Codex Lead
- supersedes: none
- applies_to: agent-team communication architecture v2 and later

## Accepted baseline

1. Codex is the sole Lead/Captain and the only user-facing decision integrator.
2. Any Pi orchestrator is an execution and communication bridge without independent product or cross-role decision authority.
3. Coordination is hub-and-spoke by default.
4. Initial direct peer communication is limited to Researcher ↔ Architect and Architect ↔ Critic.
5. Reviewer communicates through Lead during the initial rollout.
6. Critic and Reviewer may use `contact_supervisor` only for risk escalation and verdict escalation.
7. A peer exchange that changes downstream work, exposes a new material risk, or invalidates an accepted assumption must be mirrored to Lead immediately; cosmetic clarification may be mirrored at the next phase boundary.
8. Logical requests use a UUID generated once and reused for retries. Do not derive idempotency identifiers from payload hashes or content hashes.
9. Scope changes use mark-stale, cancel or reach a safe boundary, preserve partial results, and restart under a new plan version. Do not assume live parent-to-subagent broadcast exists.
10. If Critic is unavailable, work may continue with an `unverified-architecture` marker, except for security-sensitive, irreversible, publishing, deployment, external-user, billing, secret, or remote-infrastructure actions, which remain blocked pending review or User decision.

## Required v2 corrections

- Remove `most-recent-writer` as an authority rule.
- Remove undocumented transport fields such as `priority: blocking` and `reply_path: live`.
- Keep `contact_supervisor.reason` within the installed closed enum.
- Do not claim that adding `intercom` to a subagent allowlist alone proves subagent-to-subagent discovery or delivery; require an empirical capability test before rollout.
- Replace mtime-based tamper detection with ordinary git history review. Do not claim WORM or cryptographic integrity.
- Define Lead-to-User communication as ordinary Codex conversation, not `contact_supervisor`.
- Keep application-layer hashes out of the design.

## Gate

No Agent definition or communication-tool configuration may be changed until Architect produces v2 and Critic reports no blockers against this decision.
