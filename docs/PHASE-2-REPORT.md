# 阶段 2 报告：统一 Candidate 与结果流程

> **日期**：2026-08-24
> **状态**：已完成（2026-08-25 产品验收通过）
> **明确未做**：LLM / API Key / SafetyValidator 授权变更

---

## 1. 空间观察 vs 执行快照

| 概念 | 用途 | 数据来源 | 字段 |
|------|------|----------|------|
| 空间占用观察 | UI 展示、证据摘要 | `DiskAnalyzer`（深度 8，可不完整） | `occupancyObservation` |
| 清理执行快照 | 可清理估算、Plan、Validator 核对 | `RuleScanner`（深度 32） | `size`、`mtimeMs`、`entryKind`、`snapshotComplete`、`parentTarget` |

**纯 analyzer Candidate**：`size` 等字段承载空间观察，`judgment = pending`，不可勾选。

**rule-backed Candidate**：执行字段**仅**来自规则扫描；空间观察写入 `occupancyObservation` 与 `evidence`，不得覆盖执行快照。

---

## 2. 同路径合并的执行权威

`mergeScanCandidates()` 规则：

1. `discoverySources` 取并集
2. `evidence` 合并去重
3. **执行字段**（`size`、`snapshotComplete`、`mtimeMs`、`entryKind`、`parentTarget`、`id`、`ruleId` 等）取自 **rule Candidate**（incoming 优先）
4. **空间观察**取自 analyzer-only 项，写入 `occupancyObservation`
5. `judgment` 由规则项推导；空间证据不授予删除资格

修正前错误：用 `preferSnapshotFields()` 以 space-scan 覆盖 rule 执行快照，导致 UI 显示可勾选但 Validator 拒绝。

---

## 3. 不完整执行快照

当 rule-backed Candidate 的 `snapshotComplete === false`：

- `selection.selectable = false`
- `deletable = false`
- `suggestedAction = none`
- `notSelectableReason`：「扫描快照不完整，请重新扫描或进一步调查」

不修改 `SafetyValidator`；UI 层提前拦截已知会被拒绝的项。

---

## 4. Candidate 字段与文案分离

| 用途 | 常量 |
|------|------|
| 清理结果 Tab | `CANDIDATE_TAB_LABELS` |
| 设置页规则分类 | `RULE_CATEGORY_LABELS` |

设置页不再显示 Candidate 的「待判断 / 不建议」文案。

---

## 5. 新增 / 修正测试

`tests/candidate-model.test.ts`（13 项）覆盖：

1. analyzer 900 / 不完整 + rule 880 / 完整 → 执行 `size=880`、`snapshotComplete=true`
2. 合并顺序无关（analyzer→rule 与 rule→analyzer 一致）
3. `occupancyObservation.size=900` 与 `sizePartial` 保留
4. rule `snapshotComplete=false` 不可选
5. 合并后 `buildCleanupPlan` 使用 rule 执行大小
6. 增量 upsert 幂等

已删除「合并后 size 必须等于 analyzer」的错误断言。

---

## 6. 修改文件

| 区域 | 文件 |
|------|------|
| 类型 | `src/shared/types.ts`（`OccupancyObservation`、`CANDIDATE_TAB_LABELS`、`RULE_CATEGORY_LABELS`） |
| 模型 | `src/shared/candidate-model.ts` |
| UI | `src/renderer/main.ts`、`candidate-render.ts`、`safe-render.ts`、`index.html`、`style.css` |
| 测试 | `tests/candidate-model.test.ts`、`candidate-render.test.ts`、`merge-scan-results.test.ts`、`unified-scan.test.ts` |
| 文档 | `docs/AGENT-ROADMAP.md`、`docs/PHASE-2-REPORT.md` |

---

## 7. 验证结果

```
npm test         → 86 passed
npm run typecheck → pass
npm run build    → pass
git diff --check → pass（tracked 文件）
```

未跟踪文件 whitespace 检查通过。

---

## 8. 证据 UI 展示（复审修正）

新增 `src/renderer/candidate-render.ts`，将 `evidence` / `occupancyObservation` 转为结构化渲染输入：

| 展示位置 | 内容 |
|----------|------|
| 主大小旁 | `可清理逻辑大小估算` + rule 执行大小（如 880 MB） |
| 判断依据区 | `空间观察：约 900 MB（深度受限，可能不完整）` |
| 判断依据区 | 规则 evidence.summary |
| pending 项 | 类型行含「空间发现」+ 空间占用估算 |

- 使用 `textContent` 安全渲染，不插入未转义 HTML
- 不展示 Agent 证据（除非数据中真实存在）
- 测试：`tests/candidate-render.test.ts`（7 项）

**人工截图**：本轮环境无法驱动 Electron 窗口，截图待本地补拍。

---

## 9. 人工验收清单（请本地截图）

1. 纯空间 pending 项：待判断 + 空间发现来源
2. 同路径合并项：同时看见执行大小、空间观察、规则证据
3. 设置页规则分类文案正确
4. 不完整规则快照不可勾选
5. 全选、折叠、取消、统计无回归

---

## 10. 明确确认

- 未调用任何 LLM
- 未增加 API Key 设置
- 未修改 `SafetyValidator` 授权规则
- 未进入阶段 3+
