# 阶段 6 交付报告：清理计划与执行闭环

> **状态**：已完成（2026-08-28 代码与安全复审通过）  
> **Git 基线 HEAD**：`a690175`（`feat: add secure read-only investigation foundation`）  
> **工作区**：阶段 6 改动尚未 commit / push；**未进入阶段 7**

---

## 1. Git 状态

| 项 | 值 |
|----|-----|
| 起始 HEAD | `a6901751680f8fe96f318f3b19eeebbbb4e43330` |
| 结束 HEAD | `a690175`（未新建 commit） |
| 工作区 | 保留阶段 3.1 / 4.2 / 5A / 5B 及本阶段全部未提交改动 |
| 禁止操作 | 未 reset / revert / checkout 覆盖；未 commit / push |

---

## 2. 阶段目标达成情况

将链路迁移为：

```text
扫描会话 → Agent / 本地规则建议 → 用户选择 → prepare 预览
→ 用户二次确认 → confirmationId 授权 → SafetyValidator → Cleaner（回收站）
→ 重新扫描 / 复核 → 展示执行前后差异
```

| 要求 | 状态 |
|------|------|
| 无 JSON 规则 + Agent 明确建议 + 用户确认 → 可执行 | ✅ |
| JSON 规则不再是 Agent 候选项执行必要条件 | ✅ |
| Renderer / Agent / JSON 不能直接提供任意删除路径 | ✅ |
| uncertain / keep / protected / 高风险系统操作不可普通清理 | ✅ |
| 两步确认 + 一次性 confirmationId | ✅ |
| 执行后 revision bump + 自动重扫 | ✅ |
| UI 集中调整 | ⏸ 延后（仅必需确认/结果 UI） |

---

## 3. 会话授权数据流

1. **扫描**建立 `ScanSession`（`sessionId`、`revision`、`candidates` Map）。
2. **Agent / 本地规则**写回 `judgment`（含 `judgmentOrigin: agent-session | local-rule | …`）。
3. **Renderer** 仅提交 `sessionId`、`fingerprint`、`candidateIds` 调用 `prepareCleanup`。
4. **主进程** `authorizeSessionCandidates` → `evaluateSessionCleanupAuthorization` 逐项判定。
5. 返回 **预览摘要** + `confirmationId`（绑定 revision、fingerprint、candidateIds）。
6. 用户确认后 Renderer 仅提交 `confirmationId` → `executeConfirmedCleanup`。
7. 重新从会话构造计划 → `validateCleanupActions`（TOCTOU）→ `executeCleanup`（trash）。
8. 成功后 `updateScanSessionCandidates` bump revision；Renderer 触发 `startScan()` 复核。

详见 [SESSION-CLEANUP-AUTHORIZATION.md](./SESSION-CLEANUP-AUTHORIZATION.md)。

---

## 4. 信任边界摘要

| 层 | 职责 |
|----|------|
| **Renderer** | 勾选、展示确认对话框（textContent）、提交标识符 |
| **Preload** | IPC 桥接；解析 `{ok,code,message}` |
| **Agent** | 写 judgment / verdict；**不**构造 CleanupPlan |
| **SessionCleanupAuthorizer** | 会话 + 候选 ID 授权 |
| **SafetyValidator** | protected、denyDelete、快照、symlink/realpath、动作白名单 |
| **Cleaner** | 仅接受已验证内部计划；`shell.trashItem` |

---

## 5. confirmationId 生命周期

- 创建：prepare 成功时；同会话旧 pending 全部作废。
- TTL：**5 分钟**（`CLEANUP_CONFIRMATION_TTL_MS`）。
- 单次消费：重复 execute → `CONFIRMATION_ALREADY_USED`。
- 失效：新扫描、revision 变化、过期、执行完成后的会话更新。

---

## 6. Agent 与本地规则授权

| 场景 | 来源 | 可执行 |
|------|------|--------|
| 启用规则 + trash + 快照完整 | `local-rule` | ✅ |
| Agent clean/confirm + 快照完整 + deletable | `agent-session` | ✅ |
| Agent keep / uncertain | — | ❌ |
| 仅空间发现 / heuristics | — | ❌ |
| 仅展示占用（deletable=false）+ Agent 建议 | `agent-advice-only` | ❌ |
| protected path | `protected-policy` | ❌ |
| manual / system-managed 规则 | — | `ACTION_NOT_ALLOWED` |

---

## 7. TOCTOU 与路径边界

- Validator 完成 `lstat` / `realpath` 后，由主进程 **`validateAndCreateCleanupExecutionSnapshot`** 在**同一次 `lstat`** 上完成 candidate 校验与身份捕获（消除校验与快照之间的竞态）。
- 快照身份字段：`dev`、`ino`、`birthtimeMs`、`ctimeMs`、`mtimeMs`、`size`（目录为递归测量值）、`entryKind`。
- Cleaner 在每次 `trashItem` 前重新 `lstat`，严格比对身份字段；目录另做递归 size 复验。
- 同路径同 size / 同 mtime 的对象替换（inode / ctime / birthtime 变化）→ `SNAPSHOT_STALE`。
- Windows 上 `dev`/`ino` 不可靠时回退到时间戳组合比对，**禁止失败开放**。
- `seal` 仅为快照结构完整性校验，**不是**安全边界；Renderer 不得构造或修改快照。
- `isReparsePoint` / realpath、protected、`denyDelete`、规则范围边界检查保留。

---

## 8. 错误码表

完整列表见 [SESSION-CLEANUP-AUTHORIZATION.md §8](./SESSION-CLEANUP-AUTHORIZATION.md#8-稳定错误码)。

Renderer 通过 `CleanupInvokeError` 展示 `code` + `message`。

---

## 9. 测试

| 指标 | 值 |
|------|-----|
| 总测试数 | **511 passed / 2 skipped**（116 文件） |
| 复审二轮新增测试文件 | 3 |
| 复审二轮新增用例 | ~21 |

新增/扩展文件（复审二轮及三轮）：

- `tests/filesystem-identity.test.ts`
- `tests/cleanup-rescan-lifecycle.test.ts`
- `tests/cleanup-snapshot-validation.test.ts`（原子校验+快照、竞态注入）
- `tests/cleanup-verify-directory-anchor.test.ts`（Cleaner 测量后 anchor 复验）
- `tests/cleanup-execution-toctou.test.ts`（扩展身份 TOCTOU、junction/symlink skipIf）
- `tests/cleanup-confirmation.test.ts`（200 tombstone 满额边界）
- `tests/cleanup-result-lifecycle.test.ts`（manifest / 复扫对比）
- `tests/session-cleanup-e2e.test.ts`（`applyAgentRecommendations` 生产批量入口）

**验证命令**（均已通过）：

```text
npm test          → 511 passed, 2 skipped
npm run typecheck → passed
npm run build     → passed
git diff --check  → passed（仅 CRLF 警告）
```

---

## 10. 执行后复核策略

1. `executeConfirmedCleanup` 成功后立即固化 `CleanupOutcomeManifest`（`succeededPaths` / `prepareRejected` / `executionFailed` / `executionRejected`）。
2. 主进程 bump `revision` → 旧 confirmation 失效。
3. Renderer 展示清理摘要后，以独立生命周期触发 `startPostCleanupRescan()` / `startScan({ confirmRescan: false, skipAutoAgent: true })`。
4. 复扫状态：`rescanning` → `rescan-completed` | `rescan-failed` | `rescan-cancelled`；**清理成功摘要始终保留**（`status-text` 在复扫期间不被通用扫描文案覆盖）。
5. 失败/取消后可通过「重新复核」按钮重试；普通「开始扫描」会显式放弃旧 manifest。
5. 复扫对比仅对 `succeededPaths` 判断已消失/仍存在；未批准或未执行路径不得计入“已清理”。
6. 用户停止复扫时不使用部分扫描数据生成对比，不清除清理摘要。

---

## 11. 主要代码变更

| 区域 | 文件 |
|------|------|
| 共享类型/错误 | `cleanup-errors.ts`、`cleanup-ipc.ts`、`session-cleanup-authorization.ts` |
| 主进程清理 | `cleanup-service.ts`、`cleanup-ipc.ts`、`cleanup-confirmation-store.ts`、`session-cleanup-authorizer.ts`、`cleanup-request.ts` |
| 校验/执行 | `safety-validator.ts`、`cleanup-execution-guard.ts`、`filesystem-identity.ts`、`plan-builder.ts`、`cleaner.ts` |
| 候选模型 | `candidate-judgment.ts`（`canAgentSessionAuthorizeCleanup`）、`candidate-model.ts` |
| IPC/Preload | `preload/index.ts`、`main/index.ts` |
| Renderer | `main.ts`、`cleanup-result-state.ts`、`cleanup-rescan-lifecycle.ts`、`post-cleanup-rescan-controller.ts` |

---

## 12. 已知限制

1. **UI 集中调整延后**——确认对话框为阶段 6 最小实现，非最终视觉方案。
2. **复核策略**——清理后自动重扫（`confirmRescan: false`）并生成对比摘要；非增量路径级复核。
3. **人工验收**——须在真实环境验证回收站行为、`requiresAppClosed` 提示、长路径展示。

## 复审整改（P0/P1）

| 项 | 整改 |
|----|------|
| P0-1 | 引入 `LocalExecutionSafety`（`rule-eligible` / `agent-confirmable` / `advice-only` / `policy-blocked`），与 legacy `deletable` 分离；调查队列经 `markCandidateAgentConfirmable` 提升；真实链路 E2E 测试 |
| P0-2 | `CleanupExecutionSnapshot` + Cleaner 每项 `trashItem` 前重新校验；`cleanup-execution-toctou.test.ts` |
| P1-1 | 清理结果独立保存；`startScan({ confirmRescan: false, skipAutoAgent: true })`；`cleanup-result-state.ts` + 生命周期测试 |
| P1-2 | pending / tombstone 分离；tombstone TTL；全局上限；ID 长度限制 |

### 复审二轮整改（2026-08-28）

| 项 | 整改 |
|----|------|
| P0 快照身份 | `filesystem-identity.ts`；Validator 从 `lstat` 捕获 `dev/ino/birthtimeMs/ctimeMs`；Cleaner 重比对；同属性替换 → `SNAPSHOT_STALE` |
| P1 confirmation 满额 | 先过期 → 淘汰最旧 tombstone → 最后淘汰历史 pending；禁止删除刚创建令牌；`CONFIRMATION_STORE_FULL` |
| P1 清理/复扫生命周期 | `cleanup-rescan-lifecycle.ts`；`main.ts` 拆分 try/catch；`skipAutoAgent` 接通；取消复扫保留清理摘要 |
| P1 复扫 manifest | `buildCleanupOutcomeManifest` 仅追踪实际执行路径；`prepareRejected` / `executionFailed` / `executionRejected` / `succeeded` 分离 |
| E2E 补强 | `mapSpaceScanItem` → `finalizeLocalScanItem` → `applyAgentRecommendations` → prepare → execute |

### 复审三轮整改（2026-08-28）

| 项 | 整改 |
|----|------|
| P0 校验/快照竞态 | `validateAndCreateCleanupExecutionSnapshot` 单次 `lstat` 原子校验+身份捕获；目录测量后 anchor 复验；快照失败不中断整批 |
| P1 复扫摘要 UI | `resolveScanInitializationStatusText`；复扫期间 `status-text` 保持清理摘要 |
| P1 复扫重试闭环 | `startPostCleanupRescan()` + 「重新复核」按钮；`baseCleanupOutcomeSummary`；普通扫描 `ordinaryScan` 放弃 manifest |
| Windows 安全测试 | symlink/junction `skipIf` 探测；junction/protected alias 专项；禁止空 return 假通过 |

### 复审四轮整改（2026-08-28）

| 项 | 整改 |
|----|------|
| P0 Cleaner 目录测量后 anchor | `verifyDirectoryAfterMeasurement`：测量后第二次 `lstat` + identity anchor 复验；可注入 deps |
| P1 bigint 身份读取 | 生产路径 `lstat(path, { bigint: true })`；`birthtimeNs/ctimeNs/mtimeNs` 字符串；`captureMode`；非 bigint 失败关闭 |
| P1 扫描 preflight | `planScanPreflight` + `commitScanPreflight`；所有确认通过后才 `abandonPostCleanupRescanContext`；可合并双确认 |

### 最终复审通过（2026-08-28）

代码与安全复审确认无剩余 P0/P1 阻断项：

| 项 | 结论 |
|----|------|
| Cleaner 目录测量后 anchor | 第二次 `lstat` + identity anchor 复验 ✅ |
| bigint 身份读取 | 生产路径 `lstat(path, { bigint: true })`；非事后 `String(number)` ✅ |
| 快照隔离 | 单项 `SNAPSHOT_STALE` 不中断整批 ✅ |
| 扫描 preflight | 全部确认通过后才清除复扫上下文 ✅ |
| 复扫闭环 | 失败 / 取消 / 重试 / 防并发 ✅ |
| confirmation + 授权 + 结果对比 | 保持正确 ✅ |

**自动化验证**：`npm test` → **511 passed, 2 skipped**；`typecheck` / `build` / `diff-check` 均通过。2 skipped 为当前环境不支持文件 symlink 的显式跳过；junction 专项测试已实际运行，不构成阻断。

## 13. 人工验收清单（真实环境，仍待执行）

- [ ] Windows 回收站：实际移入回收站行为与审计日志
- [ ] `requiresAppClosed` 提示在确认框单独展示
- [ ] 清理后自动复扫、取消复扫与「重新复核」按钮
- [ ] 常见分辨率与窄窗口 UI 可读性
- [ ] 无 Key：本地规则候选项 prepare → 确认 → 回收站
- [ ] 有 Key：Agent 明确建议的非规则候选项可执行（非仅展示占用项）
- [ ] 仅展示占用 / uncertain / keep 不可勾选或 prepare 拒绝
- [ ] 扫描后修改目标文件 → 执行报 SNAPSHOT_STALE
- [ ] 确认后等待 >5 分钟 → CONFIRMATION_EXPIRED
- [ ] 清理后旧 confirmationId 不可复用
- [ ] 开发者工具：cleanup IPC 无 path 字段

---

## 14. 文档更新

| 文档 | 变更 |
|------|------|
| `SESSION-CLEANUP-AUTHORIZATION.md` | 新增 |
| `PHASE-6-REPORT.md` | 新增（本文档） |
| `AGENT-ROADMAP.md` | 阶段 6 → 已完成 |
| `PRODUCT-AGENT-DESIGN.md` | §5 / §12 当前实现状态 |
| `DECISIONS.md` | 阶段 6 授权与 TOCTOU 决策摘要 |
| `CLEANUP-TASK-MODEL.md` | 执行闭环章节 |
| `README.md` | 阶段 6 状态说明 |

---

## 15. 明确未做

- **阶段 7**（用户经验库、性能优化、UI 集中调整）——范围待产品确认后再启动
- **commit / push**（等待阶段 7 方向敲定）
- Shell / 永久删除 / 任意路径删除

---

**阶段 6 已完成。** 等待阶段 7 / UI 集中调整方向确认后再进入下一阶段实现。
