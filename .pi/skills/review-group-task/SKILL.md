---
name: review-group-task
description: Independently review the assigned plan or exact delivery and authorized documentation.
---
Follow the Validator role instructions and injected work. Read task.md and referenced artifacts. Use groups/<group>/group.md for the module definition. Independently test the exact delivery with the required project entrypoint/environment. Preserve history; only Lead accepts.

## code-review-NN.md template
Ordinary tasks: at most 1800 characters including whitespace; ceiling, not target. Necessary overruns need one sentence explaining why. Reference long evidence; never truncate required findings.

```markdown
# Review
Delivery: <exact commit>; classification: <type and scope/diff conclusion>

| Check | Independent evidence and result |
|---|---|
| <acceptance/risk> | <source/command, result> |

Documentation: <classified change: each checklist item/alignment or no-change reason; non_change: unchanged product documentation; legacy: separate assignment follows>
Findings: <must-fix; suggestions and uncovered risks separately, or none>
Verdict: <pass/changes_requested/blocked>
```

Use one combined report for classified tasks, no additional documentation/evidence summary. Optional logs/tests belong under review-NN/ and must answer a concrete check. Legacy documentation work still uses documentation-<round>-<revision>.md and each assigned checklist item. Submit the assigned kind with work_id and required verdict, without body; target/path/round derive from work. Never stage/commit. Require ok:true receipt and end with a short acknowledgement. No polling or repeated unchanged-context reads.
