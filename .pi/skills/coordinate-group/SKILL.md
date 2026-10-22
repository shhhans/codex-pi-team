---
name: coordinate-group
description: Coordinate a module task with proportionate planning, independent reviews and concise task and delivery documents.
---
Read the current task and work from injected runtime context. Only Lead changes the durable groups/<id>/group.md definition. Maintain task.md and submit kind=task with planning=direct, plan, or review, explaining why that route is sufficient. Direct begins implementation; plan adds only a plan; review adds one adversarial plan review. Omission keeps legacy review. Simple tasks should normally go direct. Do not expand acceptance while translating Lead scope. Same-group peers fix and review directly. Resolve blockers in decision-<round>.md (kind resolution), never alter prior evidence. Classify initial task submission with task_type=non_change, small_change, or large_change and a one-clause reason in task.md. non_change permits task artifacts but no product code/tests/config/module-document changes; small_change is local and known; large_change has material design/interface/state/concurrency/recovery/compatibility risk. Default direct for non_change/small_change, review for large_change; use plan when appropriate to uncertainty. Judge impact, not line count. Validator combines results/code and applicable documentation review in code-review-NN.md, then delivery opens directly. Check acceptance, exact commits and unresolved issues while preparing delivery, without another report. Existing unclassified tasks retain separate documentation_review work; follow that assigned legacy work. Only Lead accepts and integrates. Cross-group communication is Coordinator-to-Coordinator; report changed external commitments to Lead. All process paths are groups/<group>/tasks/<task>/. Each artifact has one author and is submitted once; implementation.md has versioned snapshots. Task submission dispatches automatically; do not repeat the assignment through team_send. Use team_send for new information/questions/replies, never as a replacement for team_submit. Use team_service only for structured lifecycle actions on named services declared in the target project's .pi/services.json; inspect before start/stop and use review mode for a registered delivery snapshot. Save a concise current-task summary before compact when asked. Keep the group available and end completed turns idle.

Task identity is injected by runtime. Use the owned work_id; round and review target can derive from that work. Require an ok:true submission receipt. On rejection follow code/next_action and authoritative work; never infer success from prose. Handle incoming steering messages before delivery. Preserve frozen delivery files; independent review evidence goes under review-NN/. An unfinished_work alert requires Coordinator recovery or escalation. Group onboarding is finite and separate from business tasks; the definition is Lead-owned, and Coordinator acknowledges the assigned responsibilities only after receiving both Executor and Validator acknowledgements.

Use team_read when context is missing, a submission is rejected, or recovery/compaction requires refresh_context:true. Read task.md before task-specific discovery or execution; no assigned work means end idle. Read published shared knowledge with team_read shared_context:true when its version changes and it is relevant. Do not repeatedly read unchanged context. Choose extra checks for a concrete risk, failed result or new assumption; explain why repeated checks add evidence. Distinguish Lead requirements, implementation choices and optional suggestions.

Write task.md once before initial dispatch as the current-task coordination summary; preserve it after submission. Record later decisions through messages or assigned decision artifacts, and refer scope changes to Lead. Choose direct for bounded work with known interfaces, plan for coordination or design uncertainty, and review for consequential state, concurrency, recovery or compatibility risks. Record the concrete reason without adding acceptance conditions. At delivery maintain only reusable team knowledge: module boundaries, interface contracts, verified pitfalls and unresolved durable constraints, with source references. Put the complete concise replacement under an English `## Shared knowledge` heading in delivery.md and submit shared_context:{mode:"update"}; if unchanged use {mode:"reuse",version:<published version>}. If no knowledge exists and none is needed, omit the field and explain that in delivery.md. Lead checks changed knowledge during normal acceptance; publication follows successful integration. Role continuation remains automatic compaction.

## Compact document rules

Use the templates below in the document's working language. Replace placeholders and omit empty optional sections. A requirement may be translated or shortened only if its meaning and observable acceptance remain intact.

- Ordinary task.md: at most 1200 characters total. Ordinary delivery.md: at most 1500 characters excluding Shared knowledge. Aim shorter; do not pad to the ceiling. If essential task-specific information cannot fit, add one line explaining why and keep only the necessary detail. No additional approval or workflow stage is required.
- State each fact once. Do not repeat the objective as scope, acceptance, context and change summary. Scope lists only boundaries not already clear from the objective. Give a one-clause planning rationale.
- Do not reproduce role duties, handoff stages, tool syntax, repository-wide instructions, injected worktree paths, or routine Git ancestry. Include a base ref and the exact final code/documentation commits where the template asks for them.
- Cite repository-relative evidence paths and sections/test cases. Acceptance entries give a result and a pointer, not copied source, full stdout, JUnit contents or another review's reasoning. Inspection must still be performed; concise reporting does not replace independent review.
- Report only actual unresolved risks or material evidence limits. Use "None identified" when appropriate; do not invent caveats about optional features or repeat ordinary role capabilities.
- Shared knowledge contains durable, sourced module facts and applicability conditions. Do not promote a temporary task restriction into a permanent rule, copy environment-specific executable paths, or copy acceptance/review narratives into memory. For an update, preserve still-valid team knowledge in the complete replacement and state essential facts concisely; the existing runtime limit is 6000 characters. For reuse, write one version-reference line without restating or re-verifying every item merely to reproduce the summary.
- Write the process file, then submit its work_id/kind/path and required version/verdict fields. Omit body on process submissions: runtime reads the file. Only onboarding requires an acknowledgement body. Do not echo the report in the final chat message; a short receipt/reference is sufficient.

## task.md template

```markdown
# Task <task>
Objective: <one sentence describing Lead's requested result>
Scope: <essential boundaries only>
Base: <Lead base_ref>
Type: <non_change|small_change|large_change> — <one-clause reason>
Route: <direct|plan|review> — <one-clause reason>

## Acceptance
- A1: <observable Lead requirement>

## Documentation
Paths: <explicit delegated paths, or none>
Checklist: <Lead checklist items or precise reference>

## Context
<Only necessary task-specific decisions, dependencies or source references; omit if none.>
```

## delivery.md template

```markdown
# Delivery <task> — D<round>
Result: <one sentence describing the delivered outcome>
Code commit: <full commit>
Documentation commit: <full commit, or "same as code">

## Acceptance
- A1: <met|unmet|unverified> — <brief result; evidence path and section/case>

## Reviews
Code: <verdict; review path>
Documentation: <combined review path and conclusion; non_change: no product changes verified>
Risks: <actual unresolved issue or material evidence limit; otherwise "None identified">

## Shared knowledge
<Choose one: "Reused v<N>; unchanged." / sourced complete replacement / "None.">
```

Match the knowledge line to submission: reuse uses shared_context:{mode:"reuse",version:N}; a replacement uses {mode:"update"}; no existing or new knowledge uses omission. In reuse mode, the runtime binds the version/hash, so do not paste the hash or prior summary again. Keep the exact `## Shared knowledge` heading for updates. Add acceptance entries as needed; reference full review details rather than adding more overview/review/change-summary sections.
