# 规则体系 V2（阶段 4.1）

> 阶段 4.1 引入规则四层架构与 RuleDraft 草稿闭环。V1 说明见 [RULES-v1.md](./RULES-v1.md)（顶部已标注迁移关系）。

## 判断与授权（阶段 4.1 收尾）

清理资格**仅**来自已启用的本地规则（官方包、已批准并启用的用户/Agent 规则、迁移规则）。优先级：

1. **系统安全策略**（`protected-paths.json`）— 始终禁止  
2. **本地规则** — 唯一可授予 `deletable` / 可勾选的来源  
3. **Agent** — 复核与解释；可降级，不可扩大权限  
4. **空间分析 / 通用启发式** — 仅 evidence（`space-evidence-only`）

`JudgmentOrigin` 字段（非文案推断）表达来源：`local-rule`、`local-rule-agent-reviewed`、`agent-advice-only`、`space-evidence-only`、`protected-policy`。

无 API Key 时 Agent 层跳过，本地规则结果完整可用。有 Key 时扫描与 Agent 复核在 UI 中为同一任务的不同阶段。

扩展规则（RuleDraft）**不是**普通清理的必经步骤；扫描完成后通过次要入口进入规则样本模式。

启用/禁用规则只影响**后续扫描**；当前结果不自动变化，启用后须用户确认重新扫描。

## 四层架构

| 层级 | 目录/存储 | 作用 | 清理授权 |
|------|-----------|------|----------|
| **1. 系统安全策略** | `config/safety/protected-paths.json` | 受保护路径、盘符根、穿越防护、回收站优先等硬性约束 | 否（只读） |
| **2. 通用识别规则** | `config/heuristics/generic.json` | 抽象 cache/logs/temp 等特征，补充 Candidate evidence | **否** |
| **3. 应用清理规则包** | `config/rule-packs/official/*.json` + `{userData}/user-rule-packs.json` | Cursor、浏览器、开发工具等具体知识 | 是（经 Validator） |
| **4. 规则草稿** | `{userData}/config/rule-drafts.json` | Agent / 导入 JSON / 旧规则迁移产物 | **仅批准后编译为 Recipe** |

## RuleDraft v1

Agent 与外部 JSON **只能**生成草稿，字段示例：

- `schemaVersion`, `name`, `contentType`
- `basePlaceholders`（仅允许 `%TEMP%` 等白名单占位符）
- `relativePatterns` / `subdirs` / `globDirs`
- `maxDepth`, `maxAgeDays`, `reason`, `impact`, `suggestedRisk`, `source`

**禁止字段**：`deletable`, `defaultChecked`, `nativeManaged`, `command`, `exec`, `script`, `shell` 等。

## 生命周期

```
draft → validated → previewed → approved → enabled/disabled → retired
```

- 导入 JSON **不会**直接启用。
- 批准前必须在**当前扫描快照**上 dry-run 预览。
- 批准后本地编译为保守 `CleanupRecipe`：`defaultChecked: false`、`cleanupStrategy: trash`。
- 生效须**重新扫描**；旧快照中的 Candidate 权限不变。

## 扫描后闭环

```
扫描完成 → 选择候选项 → agent:generate-rule-draft / 导出编写包
→ 校验 → 匹配预览 → 用户批准 → 保存 → 重新扫描后参与规则匹配
```

Renderer 仅可发送 `{ sessionId, candidateIds }`，不得注入路径或 Key。

## 无模型降级

- 官方规则包与用户已批准规则包继续作为 fallback。
- 无 Key 时可导出「规则编写包」（脱敏摘要 + Schema + 禁止字段说明）。

## 未实现（本阶段刻意不做）

- 在线规则市场、远程更新、签名服务
- 阶段 5 多轮工具调用
- 阶段 6 Validator 会话授权迁移
