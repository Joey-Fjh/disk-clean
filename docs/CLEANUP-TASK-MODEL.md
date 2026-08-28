# 统一清理任务模型（阶段 4.2）

> Disk Clean 将一次「电脑清理」封装为**单一任务**，而非「规则扫描」「空间分析」「Agent 分析」三个割裂流程。

**实现入口**：`src/shared/cleanup-task-model.ts`  
**Renderer 适配**：`src/renderer/scan-task-state.ts`

---

## 1. 任务阶段

```text
idle
  ↓ 用户点击「开始扫描」
scanning        — 扫描所选盘符，建立空间占用与目录摘要，收集规则证据
  ↓
organizing      — 应用保护策略与内置规则，整理候选项，生成规则未覆盖的空间项
  ↓
analyzing       — 无 Key：本地规则整理完成；有 Key：多轮 Agent 只读调查与智能复核（5B）
  ↓
planning        — 统一生成分类、风险与建议动作
  ↓
completed | failed | cancelled
```

| 阶段 | 内部触发条件（简化） |
|------|---------------------|
| `scanning` | `scanning === true` 且 `scanPhase === 'space-discovery'` |
| `organizing` | `scanning === true` 且 `scanPhase === 'rule-identification'` |
| `analyzing` | 扫描结束且 `agentReviewing === true` |
| `planning` | `planning === true`（预留；当前与 analyzing 衔接紧密） |
| `completed` | 扫描与 Agent 均结束且成功 / 无 Key 跳过 |
| `failed` | Agent 分析失败 |
| `cancelled` | 用户取消扫描 |

映射函数：`mapScanPhaseToCleanupTaskPhase()`。

---

## 2. 无 Key 与有 Key 流程

两种模式共享**同一阶段机**，差异仅在 `analyzing` 阶段：

| | 无 API Key | 有 API Key |
|---|-----------|------------|
| scanning / organizing | 相同 | 相同 |
| analyzing | 副标题「正在应用本地清理规则」；跳过模型调用 | 主标题「Agent 正在分析 N 个高占用位置」 |
| completed | 「分析完成（未配置模型，已使用本地规则结果）」 | 「分析完成」 |
| failed | 不适用（不调用 Agent） | 「智能复核失败，已保留本地规则结果」 |

**无 Key 时**：依靠审计后的内置规则完成传统垃圾清理。  
**有 Key 时**：在同一任务中增加 Agent 对大占用、未知目录与规则未覆盖区域的复核建议。

---

## 3. 进度文案

### 主标题（`resolveCleanupTaskHeadline`）

| 阶段 | 示例 |
|------|------|
| scanning | 正在扫描 C: 盘 |
| organizing | 已扫描 12,340 个项目，正在整理空间占用 |
| analyzing（有 Agent 候选） | Agent 正在分析 8 个高占用位置 |
| analyzing（无 Agent 候选） | 正在应用本地清理规则 |
| planning | 正在生成清理建议 |
| completed | 分析完成 |
| completed（无 Key） | 分析完成（未配置模型，已使用本地规则结果） |
| failed | 智能复核失败，已保留本地规则结果 |
| cancelled | 扫描已停止 |

### 副标题（`resolveCleanupTaskSubline`）

| 条件 | 文案 |
|------|------|
| `resultsUpdating === true` | 结果仍在更新… |
| organizing | 正在应用本地清理规则 |
| analyzing（running） | 正在进行智能复核… |
| failed | 本地规则结果仍可使用 |
| cancelled | 未运行智能复核 |

主标题与副标题**不得重复**同一语义（4.1/4.2 已修复）。

---

## 4. 失败、取消与失效

| 场景 | 行为 |
|------|------|
| Agent 失败 | 阶段 → `failed`；本地扫描与规则整理结果**保留**；副标题提示本地结果仍可用 |
| Agent 跳过（无 Key） | 阶段 → `completed`；不视为失败 |
| 停止 Agent | **不**取消已完成的本地扫描结果 |
| 取消整个扫描 | 阶段 → `cancelled`；**不**继续自动 Agent 分析 |
| 新扫描开始 | 旧 `sessionId` 的 Agent 结论、规则预览、调查缓存失效；须重新匹配 fingerprint |

会话机制：复用 `ScanSession` 的 `sessionId`、`revision`、`fingerprint`；禁止旧响应覆盖新快照。

---

## 5. 与结果分类的关系

任务进行中：

- `identifying` — 扫描与本地规则整理未完成
- `analyzing` — Agent 复核进行中（`agentReviewing === true` 时，pending 项可显示为「正在分析」）

任务完成后，候选项落入 5 个稳定分类（见 [PHASE-4.2-REPORT.md](./PHASE-4.2-REPORT.md) §5）：

建议清理 / 谨慎清理 / 高风险操作 / 空间占用 / 建议保留

---

## 6. 5B 调查编排（已完成）

多轮编排见 [INVESTIGATION-ORCHESTRATION.md](./INVESTIGATION-ORCHESTRATION.md)。候选准备仍由 `agent-candidate-prep.ts` 完成，**使用 canonical `candidateRef`**（排序不改变编号）。

```typescript
buildAgentInvestigationCandidates(items, options?) → AgentInvestigationCandidate[]
```

### 候选类型（`AgentCandidateKind`）

| kind | 含义 |
|------|------|
| `large-directory` | 大目录占用 |
| `large-file` | 大文件 |
| `rule-confirmed` | 内置规则已确认、 locallyAuthorized |
| `heuristic-suspect` | 通用 heuristic 可疑特征 |
| `unknown-occupancy` | 未识别高占用 |
| `high-risk-readable` | protected 策略下仍可只读分析 |
| `truncated` | 扫描深度或权限截断 |

### 选择策略

- 程序**自动**排序选取（默认最多 12 项，≥50 MiB 阈值），**不要求**用户逐项选择
- 综合：可释放空间、规则置信度、未知程度、风险等级、调查成本
- `protected-policy` 项可进入候选（`high-risk-readable`），供 5B 只读调查；**不**因此获得 `deletable`
- 输出含 `candidateRef`（`candidate-1` …）供 5A 工具与 Prompt 映射

### 5B 将在此基础上

- 多轮调用 5A 只读工具（`list_children` / `summarize_directory` / `sample_entry_names`）
- 汇总证据 → 统一清理计划
- **仍不**在 5B 内扩大本地 `deletable`（阶段 6 才迁移 Validator 会话授权）

---

## 7. 清理执行闭环（阶段 6，进行中）

用户勾选可选项后的主流程：

```text
getScanSessionInfo → prepareCleanup(sessionId, fingerprint, candidateIds)
→ 确认对话框（项数、空间、分档、依据、requiresAppClosed）
→ executeConfirmedCleanup(confirmationId)
→ SafetyValidator + Cleaner(trash) → postReview → startScan() 复核
```

| 阶段 | 说明 |
|------|------|
| prepare | 主进程授权 + 生成预览；无效/未授权 ID 记入 `rejectedCount` |
| confirm | Renderer 展示摘要；用户二次确认 |
| execute | 消费 `confirmationId`；TOCTOU；仅回收站 |
| review | `revision` bump；旧 token 失效；全量重扫 |

授权细节见 [SESSION-CLEANUP-AUTHORIZATION.md](./SESSION-CLEANUP-AUTHORIZATION.md)。

---

## 8. 与旧 `ScanTaskPhase` 的关系

4.2 起 `ScanTaskPhase` 为 `CleanupTaskPhase` 的类型别名；旧代码引用 `scan-task-state.ts` 的函数名保持不变，内部转发至 `cleanup-task-model.ts`。

---

## 相关文档

- [PHASE-4.2-REPORT.md](./PHASE-4.2-REPORT.md)
- [PRODUCT-AGENT-DESIGN.md](./PRODUCT-AGENT-DESIGN.md) — 统一任务 UX 节
- [INVESTIGATION-TOOLS.md](./INVESTIGATION-TOOLS.md) — 5A 只读工具
- [PHASE-5A-REPORT.md](./PHASE-5A-REPORT.md)
- [PHASE-6-REPORT.md](./PHASE-6-REPORT.md)
- [SESSION-CLEANUP-AUTHORIZATION.md](./SESSION-CLEANUP-AUTHORIZATION.md)
