# User Experience v1

## 经验类型

1. **keep-exclusion** — 用户确认「以后保留此项」；下次扫描归入建议保留，不可自动勾选。
2. **recognition-hint** — 仅追加 evidence / 标签，不授予删除授权（API 已支持，UI 创建入口后续可扩展）。

## 存储

- 路径：`%APPDATA%/disk-clean/config/user-experience.json`
- 上限：200 条；单文件 256KB；字段长度限制见 `user-experience-limits.ts`

## 安全

- Renderer 不得提交 path、deletable 或规则授权字段
- 主进程从 ScanSession 解析候选项并生成 matcher（ruleId、contentType、相对路径特征、软件名）
- protected path 与阶段 6 Validator 仍为最终边界

## 生命周期

- 保存后提示「下次扫描生效」
- 启用/停用/删除后需重新扫描才反映到结果
