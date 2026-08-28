# 阶段 4.2 交付报告（统一清理模型、内置规则审计与规则中心 UX）

**阶段名称**：统一磁盘清理模型、内置规则审计与规则中心 UX  
**状态**：**已完成**（代码与自动测试通过，待人工截图验收）  
**日期**：2026-08-27  
**Git 基线 HEAD**：`a690175`（`feat: add secure read-only investigation foundation`，阶段 5A）  
**工作区**：阶段 4.2 改动**尚未 commit / push**

---

## 1. Git 基线与工作区

| 项 | 值 |
|----|-----|
| 保留提交 | `a690175` — 阶段 5A 只读调查基础设施 |
| 工作方式 | 未 reset / revert / 覆盖历史提交 |
| 4.2 改动 | 共享类型、规则包、扫描整理、结果分类、任务模型、规则中心与首页闭环等 |
| 本报告 | **未 commit、未 push** |

---

## 2. 现状审计结论（8 项）

| # | 审计点 | 结论 | 4.2 处理 |
|---|--------|------|----------|
| 1 | official pack 是否仅为旧 rules 数组包装 | **是**。五个 `config/rule-packs/official/*.json` 与 `config/rules/*.json` 内容同源，仅增加包级 Manifest | 同步审计修正至两处；`rule-layer-service` 以 pack 为准加载，`reviewStatus: disabled` 规则不进入活动规则集 |
| 2 | 扫描是否围绕规则路径而非完整盘符摘要 | **部分成立**。`combined` 模式先 `DiskAnalyzer` 空间发现，再 `RuleScanner` 规则识别；空间项与规则项合并 | 统一为 `CleanupTaskPhase` 单任务；organizing 阶段明确「整理空间占用 + 应用本地规则」 |
| 3 | Program Files / Windows 等为何进入「待判断 / 不建议」 | **概念混淆**：protected 路径被当作「不建议清理」而非「空间占用」 | `judgmentOrigin: protected-policy` → 展示分类 **空间占用**；`resolveCleanupActionKind` → `no-action`；Agent 仍可只读分析（5A/5B） |
| 4 | 空间 / 规则 / Agent 是否 UI 割裂 | **是**。旧三档 Tab + 独立 Agent 横幅 + 扫描副标题重复 | `cleanup-task-model.ts` 统一阶段与主/副标题；`scan-task-state.ts` 复用同一模型；结果区改用 5+2 展示分类 |
| 5 | 内置规则是否存在过宽或不安全授权 | **是**。`app-logs` 的 `%LOCALAPPDATA%/**/Logs`；浏览器 `**/Cache`；Temp 无年龄限制 | 见下文「规则修正清单」与 [BUILTIN-RULE-AUDIT.md](./BUILTIN-RULE-AUDIT.md) |
| 6 | 扩展规则是否须切换设置页才能完成 | **是**（4.1 遗留） | 首页 `#rule-extension-step-preview` 内联预览 + `#rule-extension-enable-btn` 启用；完成步骤提供立即重扫 / 稍后 |
| 7 | 规则包是否只能看名称 | **是**（4.1 部分改善） | 规则中心 `<details>` 展开包内规则卡片：路径范围、来源、版本、审核状态、是否需关软件等 |
| 8 | 长列表增量渲染与 scrollTop 是否一致 | **部分问题**（4.1 已有多项修复） | 维持单滚动区 + `preservePanelScrollTop`；新增结果分类切换不强制跳档；分批渲染与分类状态测试补充 |

---

## 3. 内置规则修正清单

| 规则 ID | 处置 | 变更摘要 |
|---------|------|----------|
| `app-logs` | **禁用** | `reviewStatus: disabled`，`deletable: false`；过宽 `%LOCALAPPDATA%/**/Logs` 不再授予自动清理 |
| `chrome-cache` / `edge-cache` | **修正** | `globDirs` 从宽泛 `**/Cache` 收窄为 `Default\Cache`、`Code Cache`、`GPUCache` 等明确缓存子目录；增加 `exclusions` |
| `firefox-cache` | **保留** | 已使用 `cache2`、`startupCache` 等明确目录 |
| `user-temp` / `windows-temp` | **修正** | 增加 `maxAgeDays: 7`，跳过 7 天内新建或修改的文件 |
| `npm-cache` 等 developer 规则 | **降级默认勾选** | 全部 `defaultChecked: false`；补充 `reviewStatus: conservative` 与元数据 |
| `cursor-cache` 等 agent 规则 | **降级默认勾选** | 全部 `defaultChecked: false`；`exclusions` / `notes` 标明不触及 auth、会话、SQLite |
| 其余已验证规则 | **保留** | 补充 `source`、`testedPlatforms`、`lastVerifiedAt` 等元数据 |

`getLayeredActiveRules()` 跳过 `reviewStatus === 'disabled'` 的规则（见 `tests/builtin-rule-audit.test.ts`）。

---

## 4. 统一清理任务模型

纯逻辑：`src/shared/cleanup-task-model.ts`  
Renderer 适配：`src/renderer/scan-task-state.ts`

| 阶段 | 含义 | 进度主标题示例 |
|------|------|----------------|
| `scanning` | 扫描所选盘符，建立空间占用与目录摘要 | 正在扫描 C: 盘 |
| `organizing` | 应用保护策略与内置规则，整理候选项 | 已扫描 12,340 个项目，正在整理空间占用 |
| `analyzing` | 无 Key：本地规则整理；有 Key：单轮 Agent 复核 | Agent 正在分析 8 个高占用位置 / 正在应用本地清理规则 |
| `planning` | 生成分类、风险与建议动作 | 正在生成清理建议 |
| `completed` | 任务完成 | 分析完成 / 分析完成（未配置模型，已使用本地规则结果） |
| `failed` | Agent 失败，**保留**本地规则结果 | 智能复核失败，已保留本地规则结果 |
| `cancelled` | 用户停止扫描 | 扫描已停止 |

**关键行为**

- 无 Key / 有 Key 为同一任务流，非三个独立任务
- 增量结果可提前展示；进行中副标题可显示「结果仍在更新…」
- Agent 失败或 `skipped_no_provider` 不丢失本地扫描与规则整理结果
- 新扫描使旧 Agent 结论、规则预览与调查缓存失效（复用 `sessionId` / `revision` / `fingerprint`）
- 未进入 `planning` 阶段的多轮工具循环（留给 5B）

详见 [CLEANUP-TASK-MODEL.md](./CLEANUP-TASK-MODEL.md)。

---

## 5. 结果展示分类（5 + 2  transient）

稳定分类（任务完成后）：`src/shared/cleanup-display-category.ts`

| ID | UI 文案 | 含义 |
|----|---------|------|
| `recommended-clean` | 建议清理 | 已有可靠清理授权，明确缓存/临时内容 |
| `caution-clean` | 谨慎清理 | 可能可清理，默认不勾选 |
| `high-risk-action` | 高风险操作 | 须卸载、系统工具或单独确认，不可批量删除 |
| `space-occupancy` | 空间占用 | 大文件/目录或 protected 统计；**不代表垃圾** |
| `recommended-keep` | 建议保留 | 系统、配置、项目或 Agent 判断应保留 |

进行中临时分类：

| ID | UI 文案 |
|----|---------|
| `identifying` | 正在识别 |
| `analyzing` | 正在分析 |

**建议动作**（`CleanupActionKind`）：`delete-trash` / `review-before-delete` / `uninstall` / `move` / `system-managed` / `keep` / `no-action` — 与展示分类解耦，Renderer 不得根据中文文案反推逻辑。

---

## 6. 高风险目录：分析 vs 操作边界

| 能力 | protected / 高风险路径 | 普通可授权规则项 |
|------|------------------------|------------------|
| 统计总体积 | ✅ | ✅ |
| 空间占用展示 | ✅ → **空间占用** 分类 | ✅ |
| Agent 只读分析上下文（5A/5B） | ✅ | ✅ |
| 普通移入回收站 | ❌ | 视规则与 Validator |
| `system-managed`（WinSxS、pagefile 等） | 展示为 **高风险操作** | — |
| Agent verdict 扩大 `deletable` | ❌ | ❌ |

`protected-policy` 候选项：`resolveCleanupDisplayCategory` → `space-occupancy`；`resolveCleanupActionKind` → `no-action`。

---

## 7. 首页内联规则预览 / 启用闭环

流程（清理页 `#rule-extension-card`）：

1. **选择样本** — 勾选候选项旁「规则样本」
2. **生成或导出** — 有 Key：生成识别规则；无 Key：导出规则资料
3. **预览** — `renderUserFacingRulePreview()` 展示匹配数、风险、样本；**无需切换设置页**
4. **启用** — `#rule-extension-enable-btn` → `confirmEnableRuleDraft` 原子启用
5. **完成** — 立即重新扫描 / 稍后；提示「重新扫描后才会更新清理结果」

用户可见术语：我的规则、保存为我的规则、待确认、已启用（内部 `RuleDraft` / `fingerprint` 不对用户暴露）。

实现：`src/renderer/rule-draft-actions.ts`、`rule-extension-mode.ts`、`rule-knowledge-settings.ts`。

---

## 8. 规则中心元数据展示

设置页「规则与知识库」：

- **内置清理规则**：按包分类；`<details>` 展开每条规则的 contentType、风险、原因、影响、来源、适用版本、`requiresAppClosed`、`reviewStatus`、路径范围摘要
- **我的规则**：预览、启用、停用、删除；编辑后须重新预览
- **安全策略**：只读，不暴露多余内部字段

规则 Schema 新增可选字段（4.2+）：`source`、`sourceUrl`、`testedPlatforms`、`testedVersions`、`lastVerifiedAt`、`requiresAppClosed`、`cleanupMethod`、`reviewStatus`、`confidence`、`exclusions`、`notes` — 见 [RULES-v2.md](./RULES-v2.md)。

---

## 9. 5B 输入契约（本轮仅准备，不实现多轮）

`src/shared/agent-candidate-prep.ts`：`buildAgentInvestigationCandidates()` 自动选取高价值候选项（大目录、大文件、规则已确认、heuristic 可疑、protected 可读、截断项等），输出 `AgentInvestigationCandidate[]` 供后续 5B 多轮调查消费。

**未实现**：多轮 `chatCompletion` 工具循环、调查时间线 UI。

---

## 10. 测试与验证

| 项 | 结果 |
|----|------|
| 总测试 | **359 项通过**（79 个测试文件） |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |

新增/扩展测试（节选）：

- `tests/cleanup-task-model.test.ts` — 统一任务阶段与进度文案
- `tests/cleanup-display-category.test.ts` — 5+2 分类与 protected → 空间占用
- `tests/builtin-rule-audit.test.ts` — disabled 规则排除、浏览器 glob 收窄
- `tests/result-category-state.test.ts` / `tests/result-category-dom.test.ts` — 分类切换与 DOM
- `tests/scan-task-state.test.ts` — 主副标题不重复
- `tests/finalize-local-scan-protected.test.ts` — protected 覆盖语义

---

## 11. 人工截图验收清单

1. **扫描中** — 主标题「正在扫描 * 盘」；副标题显示进度或「结果仍在更新…」；无重复标题、无空白 Agent 卡
2. **整理阶段** — 「已扫描 N 个项目，正在整理空间占用」
3. **无 Key 完成** — 「分析完成（未配置模型，已使用本地规则结果）」；建议清理 Tab 有内容
4. **有 Key 分析** — 「Agent 正在分析 N 个高占用位置」；失败时「已保留本地规则结果」
5. **新结果分类** — Program Files / Windows 等进入 **空间占用**，非「待判断 / 不建议」
6. **高风险操作** — WinSxS、pagefile、pnpm store 等不可批量勾选删除
7. **首页规则闭环** — 预览 → 启用 → 立即重扫 / 稍后，全程不强制跳转设置页
8. **规则中心** — 展开官方包可见元数据与路径范围；`app-logs` 不在启用规则列表
9. **1366×768 / 1920×1080** — 单纵向滚动，无嵌套滚动条

---

## 12. 明确未进入的范围

| 阶段 | 状态 |
|------|------|
| **3.1** 多 Provider 配置 | **未开始** |
| **5B** 多轮 Agent 编排与时间线 UI | **已完成**（见 [PHASE-5B-REPORT.md](./PHASE-5B-REPORT.md)） |
| **6** Validator 会话授权迁移 | **未开始** |
| 远程规则市场 / Shell 执行 | **未做** |

**未 commit / push。**

---

## 相关文档

- [CLEANUP-TASK-MODEL.md](./CLEANUP-TASK-MODEL.md)
- [BUILTIN-RULE-AUDIT.md](./BUILTIN-RULE-AUDIT.md)
- [RULES-v2.md](./RULES-v2.md)
- [PHASE-4.1-REPORT.md](./PHASE-4.1-REPORT.md)
- [PHASE-5A-REPORT.md](./PHASE-5A-REPORT.md)
