# User Experience v1

## 经验类型

1. **keep-exclusion** — 用户确认「以后保留此项」；下次扫描归入建议保留，不可自动勾选。
2. **recognition-hint** — 仅追加 evidence / 标签，不授予删除授权（API 已支持，UI 创建入口后续可扩展）。

## 存储

- 路径：`%APPDATA%/disk-clean/config/user-experience.json`
- 上限：200 条；单文件 256KB；字段长度限制见 `user-experience-limits.ts`
- 损坏或超限文件：隔离至 `user-experience-corrupt-*.json`（有容量与份数上限），再建立干净存储
- 非法条目：写入 `user-experience-isolated.json`（有容量上限）

## 匹配

- `relativePathSuffix` 使用**路径段边界**匹配，禁止 `Cache` 误命中 `CacheBackup`
- 等价 matcher 重复保存时更新已有条目，不无限增殖

## UI 来源

- keep-exclusion 命中后来源显示为 **用户经验**（`judgmentOrigin: user-experience`）
- 不得扩大 deletable、selectable 或执行授权

## 安全

- Renderer 不得提交 path、deletable 或规则授权字段
- 主进程从 ScanSession 解析候选项并生成 matcher（ruleId、contentType、相对路径特征、软件名）
- IPC 对 sessionId、candidateId、experienceId 有长度限制
- update 时空白 name/reason 会被拒绝
- protected path 与阶段 6 Validator 仍为最终边界

## 统计

- 扫描结果 `totalSize` 基于应用用户经验后的 enriched items 计算，保留项不计入可清理估算

## 生命周期

- 保存后提示「下次扫描生效」
- 启用/停用/删除后需重新扫描才反映到结果
