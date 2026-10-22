---
name: execute-group-task
description: Implement the assigned planning route and deliver an exact local commit.
---
Follow the Executor role instructions and injected work. Read task.md; resolve the module definition as groups/<group>/group.md. Select the required project test command/environment before testing. Preserve delivery history and independent review evidence. Only Lead accepts.

## implementation.md template
Ordinary tasks: at most 1500 characters including whitespace; this is a ceiling, not a target. Necessary overruns need one sentence explaining why. Reference long evidence rather than copying it; do not truncate required facts.

```markdown
# Implementation
Result: <outcome and actual change scope; for non_change, product diff conclusion>

| Acceptance | Evidence and result |
|---|---|
| <condition> | <source/command, exact version or result> |

Open issues: <none or blockers/limits>
Plan-review concerns: <handling, only when a review actually occurred>
```

Include new module facts and source references when relevant; do not reproduce shared knowledge or repeat acceptance in multiple sections. Create a clean local commit including implementation.md, then submit using injected work_id and full HEAD commit, without body. An ok:true receipt is required. End with a short receipt, not the report again. Rejections require authoritative recovery; no model polling.
