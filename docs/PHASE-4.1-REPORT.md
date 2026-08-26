# 阶段 4.1 交付报告（复审整改）

**阶段名称**：规则体系分层 + 扫描后规则草稿闭环 + 判断矩阵与 UX 收尾  
**状态**：**已完成**（2026-08-26，截图验收通过）  
**日期**：2026-08-26  
**基线 HEAD**：`26cfdec6102df546a3112bf0e3900a61ae7628a7`（阶段 4）

---

## 复审整改（本轮）

### 启用与 protected 覆盖

| # | 问题 | 修复 |
|---|------|------|
| P0 | 启用后重扫按钮被 `loadRuleKnowledgeSettings()` 清除 | 独立 `#rule-draft-post-enable` 容器；`handleRuleDraftEnabled()` 先重绘再渲染稳定提示区 |
| P1 | `confirmAndEnableRuleDraft` 两次落盘非原子 | 单次 `updateRuleDraftStatus(..., 'enabled', { compiledRuleId, sessionFingerprint, approvedAt })`；写入失败返回 `ENABLE_FAILED` |
| P1 | 规则项已是 suggested 时 protected 来源未覆盖 | `finalizeLocalScanItems` 先无条件检查 protected path，再处理 identifying/pending |
| P1 | 规则包无法查看内部规则 | `<details>` 展开包内规则摘要（占位符范围，无绝对路径） |
| P1 | 无 Key 文案仍写「仅空间发现」 | 改为「已使用本地规则完成分析」+ 本地规则/安全策略说明 |
| 尾项 | post-enable notice 生命周期未清理 | 重扫/停用/删除/失效 reload 时 `dismissPostEnableNotice()`；`syncPostEnableNotice()` 校验扩展规则仍为 enabled |

### 首页扩展规则 UI（截图复审）

| # | 问题 | 修复 |
|---|------|------|
| P0 | 扫描中空白卡片 | `.agent-analysis-banner { display:flex }` 覆盖 `hidden`；增加 `[hidden] { display:none !important }` 与横幅专用规则 |
| P1 | 「正在扫描磁盘」重复两次 | `resolveScanTaskHeadline` / `resolveScanTaskSubline` 分离；`#scan-task-status` 仅显示副标题（如「已发现 N 项」） |
| P1 | 扩展入口与选择面板并存 | 移除居中独立入口；在「待判断 / 不建议」分类说明区放置次要「创建识别规则」按钮 |
| P1 | 步骤 1 与操作卡同时展示 | 单张 `#rule-extension-card` 内切换：选择样本 → 生成/导出 → 完成 |
| P1 | 内部术语外露 | 用户可见文案统一：扩展规则、生成识别规则、导入规则 JSON、扩展规则管理；内部 `RuleDraft`/IPC 不变 |
| P1 | 步骤 2 按钮被清理勾选刷新误禁用 | `updateSelectedSummary()` 传入 `extensionStep: getRuleExtensionStep()` |
| P1 | 空 dangerous 分类仍显示扩展入口 | `shouldShowExtensionEntry` 要求 `dangerousCandidateCount > 0` |

**扩展流程单卡片步骤**

1. **选择样本** — 标题「扩展清理识别」；实时「已选择 N 项规则样本」；取消 / 下一步（未选禁用）
2. **生成或导出** — 有 Key：生成识别规则；无 Key：导出规则资料；返回选择
3. **完成** — 前往扩展规则管理 / 返回清理结果

**用户命名对照（仅 UI）**

| 旧 | 新 |
|----|-----|
| 规则草稿 | 扩展规则 / 待确认规则 |
| 生成规则草稿 | 生成识别规则 |
| 导入草稿 JSON | 导入规则 JSON |
| 规则草稿审阅 | 扩展规则管理 |
| 规则参考 | 规则样本 |

设置页 Tab：`规则草稿` → `扩展规则`

---

## 判断矩阵与扫描任务（保留）

- 矩阵：`src/shared/candidate-judgment.ts`
- 扫描整理：`src/main/scanner/scan-engine.ts` → `finalizeLocalScanItems`
- 任务阶段：`src/renderer/scan-task-state.ts`

---

## 测试

| 项 | 结果 |
|----|------|
| 总测试 | **296 项通过** |
| typecheck / build / diff-check | 全部通过 |

新增测试：

- `tests/rule-knowledge-enable.test.ts` — 启用后提示持久化、重扫关闭 notice、停用/删除/reload 失效、仍 enabled 时保留
- `tests/finalize-local-scan-protected.test.ts` — 无 Key 本地整理 protected 覆盖
- `tests/rule-confirm-enable.test.ts` — 单次落盘与失败回退
- `tests/rule-knowledge-renderer-safety.test.ts` — 规则包展开与安全渲染
- `tests/agent-analysis.test.ts` — 无 Key 文案
- `tests/agent-banner-hidden.test.ts` — Agent 横幅 `hidden` 不占布局
- `tests/scan-task-state.test.ts` — 扫描进度主/副标题不重复
- `tests/rule-extension-mode.test.ts` — 单卡片步骤机、样本计数、入口显隐
- `tests/rule-extension-ui.test.ts` — 渲染层无「规则草稿」等内部术语
- `tests/rule-draft-action-state.test.ts` — 步骤 2 按钮不被清理勾选刷新误禁用

---

## 截图验收（已通过）

1. **扫描中** — 无空白 Agent 卡片；主标题「正在扫描磁盘」不重复；副标题显示当前目标/进度
2. **选择规则样本** — 单张「扩展清理识别」卡片（步骤 1）；显示「已选择 N 项规则样本」；危险分类入口已隐藏
3. **进入下一步** — 同一张卡片仅显示步骤 2（生成识别规则 或 导出规则资料）

---

**已本地 commit；未 push。**
