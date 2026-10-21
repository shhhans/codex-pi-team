# Optional planning experiment

Coordinator task submission accepts planning=direct, plan, review; omission preserves review. Route is recorded durably and immutable on replay. Only the selected plan/review assignments are created. Final code review, documentation review and Lead acceptance remain unchanged. Role prompts, private skills, ADR0009 and tool schema align.

Validation: 5 new route/rollback/immutability/end-to-end tests pass; full deterministic suite 89/89 passed in 133.306s on 2026-10-22. Production-write policy follows actual open implementation work. Existing role/model configuration was preserved separately and not included in this change.

Live experiment MELATONIN-FLEX-01 uses two versioned experiment runs, native minute computation and 10-minute reported samples; no duplicate standalone runs. Role-instruction changes require real fresh onboarding under the existing lifecycle, so results are not a strict warm-history A/B comparison. Previous report-only task completed and finalized before deployment.
