# GitHub Issue #14 preflight/proposal

Generated: 2026-09-07T10:51:48.0979709Z

```json
{
    "issue_number":  14,
    "lookup_state":  "open",
    "decision":  "lead_fact_check_required",
    "develop_head":  "b54cfe20726e26dffa80636c50d76c89a295987c",
    "issue_url":  "https://github.com/shhhans/codex-pi-team/issues/14",
    "issue_updated_at":  "2026-09-07T09:58:41Z",
    "lookup_error":  "",
    "fact_verification":  "Lead must verify the reported behavior on develop before start",
    "generated_at":  "2026-09-07T10:51:48.0817832Z"
}
```

## Issue state
- State: open
- Decision: lead_fact_check_required
- Title: bug: Pi Team 任务完成后 Terminal 资源未回收
- URL: https://github.com/shhhans/codex-pi-team/issues/14
- Updated: 2026-09-07T09:58:41Z
- Develop HEAD: b54cfe20726e26dffa80636c50d76c89a295987c
- Lookup error:

## Lead fact check
- Verify the issue is still reproducible or has concrete current evidence on `develop`.
- If the issue is stale, missing, or the behavior is already fixed, do not start a duplicate task.
- If the issue changes architecture/ADR, product behavior, security, compatibility, or an irreversible decision, wait for user review.

## Issue body (redacted)
## 背景

Pi Team 任务完成后，Terminal 中用于启动 Executor、Reviewer、Researcher 的窗口或进程仍可能残留，导致空窗口、孤儿 launcher 或持续占用资源。

## 期望行为

当任务通过 Lead 验收并进入 reclaim/archive，或显式关闭为 incomplete 后：

- 回收该 task 创建的 Windows Terminal pane/window；
- 终止该 task 登记的 launcher 和 runtime 进程；
- 只回收当前 task 的进程，不影响其他 Pi Team task 或用户现有 Terminal；
- 回收前保留 task state、Blackboard 事件、验收/关闭证据和 dirty worktree；
- 回收操作应幂等，重复执行不会误杀其他进程；
- status、日志或回收结果应能说明哪些资源已停止、哪些本来已退出。

## 验收标准

- accept / close-incomplete 后执行回收，所有该 task 的登记进程和 Terminal 资源均退出；
- 两个 task 并行运行时，完成一个 task 不会关闭另一个 task 的 Terminal；
- launcher 已退出但 runtime 仍存活、runtime 已退出但窗口仍存活等部分失败场景均可安全处理并报告；
- 重复回收不会报错或扩大目标范围；
- 增加 fake Terminal/launcher 集成测试，并覆盖进程身份校验、task 隔离和失败降级；
- 不删除 task state、Blackboard 历史、验收证据或未提交 worktree 修改。

## 范围

重点检查 scripts/pi-team.ps1 的 accept、close-incomplete、reclaim/cleanup 生命周期，以及 Terminal launcher 的进程追踪和回收逻辑。
