# 阶段 7B 交付报告：用户确认的本地经验库

> **状态**：实现完成，待用户集中试用

## 实现摘要

| 区域 | 变更 |
|------|------|
| 存储 | `{userData}/config/user-experience.json`，原子写入、Schema 净化、非法条目隔离 |
| IPC | `experience:list/create/update/delete`，trusted sender，Renderer 仅传 sessionId + candidateId |
| 扫描应用 | `experience-enricher.ts` 在扫描结束时应用 keep-exclusion / recognition-hint |
| UI | 候选项「以后保留此项」+ 设置页「我的经验」列表管理 |
| 安全 | 经验不授予 deletable；protected policy 仍最高；需用户确认才写入 |

## 测试

- `experience-enricher.test.ts`
- `user-experience-sanitizer.test.ts`
- 全量 **563** 项通过

## 明确未做

- 云端同步、经验市场、识别提示的 UI 创建入口（仅保留排除已实现）
