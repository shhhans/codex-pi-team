# GitHub Issue #6 preflight/proposal

Generated: 2026-09-09T18:27:35.3804483Z

```json
{
    "issue_number":  6,
    "lookup_state":  "open",
    "decision":  "lead_fact_check_required",
    "develop_head":  "f3ce62cd57e2000f47c1e361780c43a8c846d68c",
    "issue_url":  "https://github.com/shhhans/codex-pi-team/issues/6",
    "issue_updated_at":  "2026-08-29T10:01:13Z",
    "lookup_error":  "",
    "fact_verification":  "Lead must verify the reported behavior on develop before start",
    "generated_at":  "2026-09-09T18:27:35.3684310Z"
}
```

## Issue state
- State: open
- Decision: lead_fact_check_required
- Lead decision: ready
- Title: process: Pi Agent 更新 Blackboard 不积极
- URL: https://github.com/shhhans/codex-pi-team/issues/6
- Updated: 2026-08-29T10:01:13Z
- Develop HEAD: f3ce62cd57e2000f47c1e361780c43a8c846d68c
- Lookup error: 

## Lead fact check
- Verify the issue is still reproducible or has concrete current evidence on `develop`.
- If the issue is stale, missing, or the behavior is already fixed, do not start a duplicate task.
- If the issue changes architecture/ADR, product behavior, security, compatibility, or an irreversible decision, wait for user review.
- Change `Lead decision: pending` to `Lead decision: ready` only after the fact check and any required User review are complete.

## Issue body (redacted)
## 问题
Pi Agent 在运行过程中更新 Blackboard 不积极，状态、进度、下一步和阻塞信息可能长时间不更新。

## 影响
- Lead 无法及时判断 Agent 是否仍在工作、已完成或被阻塞；
- Blackboard 的观察价值下降，持续任务容易出现状态漂移；
- Lead 的干预、复核和验收可能基于过期状态。

## 期望行为
明确 Pi Agent 的 Blackboard 更新协议和最低更新时机，例如：开始 slice、取得关键进展、发现阻塞、完成 slice、等待 Reviewer/Lead，以及收到新指令后。更新应包含事实、推断/待测标记、下一步和阻塞原因；不能用高频无意义心跳替代有内容的进度更新。

## 验收方向
- 每个规定生命周期节点都有可验证的 Blackboard 事件；
- 长时间工作期间按合理间隔更新有意义的进度；
- 阻塞和完成状态不会只存在于 Agent 私有上下文；
- 更新协议不改变 Lead 的验收权，也不把 Blackboard 当作控制总线。
