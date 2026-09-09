# Pi Team v3 task

```json
{
  "version": 3,
  "task_id": "ISSUE-000",
  "name": "简短任务名称",
  "objective": "用一句话描述需要达成的结果。",
  "context": [
    "可选的背景或说明性边界。"
  ],
  "base_ref": "develop",
  "branch": "pi-team/ISSUE-000-short-name",
  "worktree": "D:/Coding/Harness/Pi-team-ISSUE-000",
  "acceptance": [
    "第一个可观察的完成结果。",
    "第二个可观察的完成结果。"
  ],
  "deliverables": [
    "implementation notes",
    "verification report"
  ]
}
```

`context` 和 `deliverables` 可省略。不要在 v3 contract 中添加文件级
scope、角色 delegation、capability、criterion owner 或 artifact 映射；Lead
通过 `inspect` 查看实际变更并在 `accept` 时作出最终判断。
