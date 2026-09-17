# Active-test migration table

| Prior coverage | Treatment | Basis / replacement |
| --- | --- | --- |
| Reviewer role and review handoffs | Migrate active tests to Validator and validation handoffs | Active protocol; legacy fixtures stay under `tests/legacy/` |
| Lifecycle tool gate blocks calls | Rewrite as 20-call non-blocking reminder | Confirmed Blackboard status-track rule |
| Shared-root cleanup | Retire from default entrypoint | Each active test owns and removes its fixture repository |
| Fixed provider names / prompt text | Assert injected configuration and observable registration | Provider is configuration, not protocol |
| Contract store smoke tests | Expand to ACK, limit, ruling, notification and retry tests | New module collaboration behavior |
| `team-contract.test.mjs` launcher v3 / flat Blackboard assertions | Retire from the default active entrypoint; preserve unchanged as historical evidence | The active Runtime Store and module lifecycle tests cover session registration, restoration, contract and finalization behavior without asserting removed JSONL paths or the Reviewer role |
| `compression.test.mjs` Reviewer checkpoint harness | Retire from the default active entrypoint; preserve unchanged as historical evidence | `module-lifecycle.test.mjs` covers durable summaries, compact failure retention, and session restoration under the Validator protocol |
