# 规则体系 V2（阶段 4.1 + 4.2）

> 阶段 4.1 引入规则四层架构与 RuleDraft 草稿闭环；阶段 4.2 完成内置规则逐条审计、元数据字段与加载约束。V1 说明见 [RULES-v1.md](./RULES-v1.md)（顶部已标注迁移关系）。审计表见 [BUILTIN-RULE-AUDIT.md](./BUILTIN-RULE-AUDIT.md)。

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

## 规则元数据（阶段 4.2）

官方规则可携带以下**可选**字段（用户导入规则不得伪造 official 身份）：

| 字段 | 用途 |
|------|------|
| `source` / `sourceUrl` | 路径依据（厂商文档或本地验证说明） |
| `testedPlatforms` / `testedVersions` | 适用平台与版本 |
| `lastVerifiedAt` | 最近审计日期 |
| `requiresAppClosed` | 清理前是否应关闭相关应用 |
| `cleanupMethod` | `trash` / `system-managed` / `uninstall` / `manual` |
| `reviewStatus` | `verified` / `conservative` / **`disabled`**（disabled 不进入活动规则集） |
| `confidence` | `high` / `medium` / `low` |
| `exclusions` | 明确排除的子路径或数据类型 |
| `notes` | 审计备注 |

**4.2 审计变更摘要**：

- `app-logs` → `reviewStatus: disabled`
- 浏览器 `globDirs` 收窄；增加 `exclusions`
- `user-temp` / `windows-temp` → `maxAgeDays: 7`
- developer / agent 类 → `defaultChecked: false`，多数为 `conservative`
- `getLayeredActiveRules()` 跳过 `reviewStatus === 'disabled'`

规则中心 UI 展开官方包时展示上述元数据与路径范围摘要（只读；可复制为「我的规则」后编辑）。

## 未实现（本阶段刻意不做）

- 在线规则市场、远程更新、签名服务
- 阶段 7 用户经验库与在线规则市场
