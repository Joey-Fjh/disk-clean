# 会话清理授权模型（阶段 6）

> **状态**：已实现，待代码与安全复审。  
> **实现入口**：`src/shared/session-cleanup-authorization.ts`、`src/main/cleanup/session-cleanup-authorizer.ts`

---

## 1. 设计原则

1. **授权判定仅在主进程**——Renderer、Agent 输出、导入 JSON 均不得直接提供可执行删除路径。
2. **标识符驱动**——Renderer 仅提交 `sessionId`、`fingerprint`、`candidateIds`；路径、大小、动作由主进程从 `ScanSession` 重新构造。
3. **两步确认**——`prepare` 生成预览与一次性 `confirmationId`；`execute` 仅消费 `confirmationId`。
4. **保守合并**——Agent 与本地规则冲突时取更保守结果；任一安全策略拒绝即拒绝。
5. **TOCTOU 防护**——执行前重新校验文件系统快照与路径边界。

---

## 2. 授权来源

| 来源 | 含义 | 典型条件 |
|------|------|----------|
| `agent-session` | Agent 明确建议且会话授权 | `executionSafety === 'agent-confirmable'`；`agentVerdict` 为 `clean` / `confirm`；`snapshotComplete` |
| `local-rule` | 本地启用规则 | `executionSafety === 'rule-eligible'`；规则命中、已启用、`cleanupMethod === trash` |
| `protected-policy` | 安全策略保护 | `executionSafety === 'policy-blocked'` 或 protected path |
| `none` | 未授权 | `advice-only` 等其余情况 |

### `LocalExecutionSafety`（与 UI `deletable` 分离）

| 值 | 含义 |
|----|------|
| `rule-eligible` | 本地规则可授权执行 |
| `agent-confirmable` | 进入 Agent 调查队列后可申请会话授权 |
| `advice-only` | 仅展示/建议，不可执行 |
| `policy-blocked` | 本地策略永久禁止 |

空间扫描项默认 `advice-only`；`buildAgentInvestigationCandidates` / `applyAgentRecommendations` 路径上调用 `markCandidateAgentConfirmable` 后方可走 `agent-session`。

### Agent 与规则关系

- Agent `keep` / `uncertain` → **不可授权**（即使规则允许）。
- 仅空间发现（`space-evidence-only`）且无 Agent 明确建议 → **不可授权**。
- 仅展示占用的分析项（`deletable === false`）→ Agent 建议仅作 `agent-advice-only`，**不可** `agent-session`。
- Heuristics、空间占用、未审核规则 → 仅 evidence，**不能单独授权**。
- 不为执行 Agent 建议而自动生成或启用 JSON 规则。

---

## 3. 两步执行契约

### 第一步：`cleanup:prepare`

**输入**（`CleanupPrepareRequest`）：

```typescript
{ sessionId, fingerprint, candidateIds }
```

**主进程**：

1. 校验 `sessionId` 对应有效 `ScanSession`。
2. 校验 `fingerprint` 与 `sessionId + createdAt + revision` 一致。
3. 规范化 `candidateIds`（去重、长度、空值）→ 无效项记入 `rejected`。
4. `authorizeSessionCandidates` 逐项授权。
5. 从已授权候选项构造 `CleanupPlan` 预览摘要。
6. 创建一次性 `confirmationId`（TTL 5 分钟），绑定 `sessionId`、`fingerprint`、`revision`、`candidateIds`。

**输出**（`CleanupPlanPreview`）：项数、估算空间、风险分组计数、`basisSummaries`、`requiresAppClosed` 计数、`rejectedCount`、`approvedCandidateIds`、`rejectedAtPrepare`、`confirmationId`、`expiresAt`。不返回完整敏感路径列表。

### 第二步：`cleanup:execute`

**输入**（`CleanupExecuteRequest`）：

```typescript
{ confirmationId }
```

**主进程**：

1. 消费 `confirmationId`（单次使用；过期或已用则拒绝）。
2. 重新校验会话存在、`fingerprint`、`revision` 未变。
3. 从会话重新解析 `candidateIds` → 构造计划。
4. `SafetyValidator`：路径策略、快照 TOCTOU、动作白名单。
5. `Cleaner`：仅 `trash` / 回收站；逐项结果。
6. 更新会话候选项（bump `revision`）→ 使旧 `confirmationId` 失效。
7. 返回 `CleanupResult` + 可选 `postReview`。

---

## 4. confirmationId 生命周期

| 事件 | 行为 |
|------|------|
| `createCleanupConfirmation` | 同会话旧未消费 token 全部作废；生成新 UUID |
| TTL 5 分钟 | 过期 → `CONFIRMATION_EXPIRED` |
| `consumeCleanupConfirmation` | 移入 tombstone；重复 → `CONFIRMATION_ALREADY_USED` |
| 全局上限 200 条 | 先 prune 过期 → 淘汰最旧 tombstone → 最后淘汰历史 pending；**不得**删除本次刚创建条目 |
| 容量仍不足 | `CONFIRMATION_STORE_FULL`（不返回不可用令牌） |
| 新扫描开始 | `invalidateCleanupConfirmationsForSession` 清空该会话 pending |
| `revision` 变化（执行后更新候选项） | 未消费 token 失效 |
| fingerprint 不匹配 | `SESSION_STALE` / `SNAPSHOT_STALE` |

**禁止**：Renderer 在 execute 时追加、替换或删改 prepare 阶段的 `candidateIds`。

---

## 5. 信任边界

```text
Renderer          Preload              Main Process
   |                 |                      |
   | sessionId       |                      |
   | fingerprint     | cleanup:prepare ---->| ScanSession
   | candidateIds    |                      | authorizeSessionCandidates
   |                 |<---- preview +       | evaluateSessionCleanupAuthorization
   |                 |      confirmationId  |
   | 用户二次确认     |                      |
   | confirmationId  | cleanup:execute ---->| consumeConfirmation
   |                 |                      | SafetyValidator (TOCTOU)
   |                 |                      | Cleaner (trash only)
   |                 |<---- CleanupResult   |
```

| 组件 | 可信 | 不可信 |
|------|------|--------|
| Renderer | 展示、勾选、确认 UI | path、动作、ruleId、模型路径 |
| Agent | 建议 verdict、basis（写回 judgment） | 执行路径、绕过 Validator |
| ScanSession | 候选项快照、path、size、mtime | — |
| SafetyValidator | protected、denyDelete、symlink、realpath | — |
| Cleaner | 仅接受已验证计划 | 任意路径输入 |

所有清理 IPC 校验 **trusted sender**；拒绝未知字段、超长数组、空 ID。

---

## 6. TOCTOU 与路径边界

### 6.1 Validator 阶段（`validateCleanupActions`）

- 路径仍存在；类型未变；`mtimeMs` / 递归 size（目录）与扫描快照一致。
- 非 symlink / junction / reparse point 越界；`realpath` 在允许边界内。

### 6.2 执行快照（`CleanupExecutionSnapshot`）

- **仅主进程 Validator 构造**；Renderer 不得提供或修改。
- 通过 **`validateAndCreateCleanupExecutionSnapshot`** 在**同一次 `lstat`** 上完成：类型校验、size/mtime、目录递归测量、身份捕获。
- 目录在递归测量后执行 **identity anchor 复验**，防止测量窗口内对象被替换。
- 身份字段：`dev`/`ino`（字符串，支持 bigint）、`birthtimeMs`、`ctimeMs`、`mtimeMs`、`size`、`entryKind`。
- 快照构造失败 → 当前 action `SNAPSHOT_STALE` rejected，**不中断**其余 action。
- 非 file/directory 特殊类型 → rejected；`seal` 仅为内部完整性检测，非安全边界。

### 6.3 Cleaner 阶段（`verifyCleanupExecutionSnapshot`）

- 每次 `trashItem` 前重新 `lstat(path, { bigint: true })`，比对身份字段。
- **目录**：第一次 anchor 比对 → 递归测量 → **第二次 `lstat` + anchor 复验** → 才允许成功。
- protected / `denyDelete` / 规则范围 / realpath 边界保留。
- 同路径同 size / 同 mtime 的对象替换 → `SNAPSHOT_STALE`。
- `dev`/`ino` 均为非零时才视为可靠 inode 锚点；否则使用 `timestamp-fallback`（Ns 字段）。
- 非 bigint stat 环境 → 失败关闭，不得静默降级。

`path-access-policy.json` 的 `denyDelete`、盘符根、Windows/System、Program Files 等禁止普通删除范围一并校验。

### 6.4 Renderer 复扫对比

- `CleanupOutcomeManifest` 仅对 `succeededPaths` 做消失/仍存在判断。
- `prepareRejected` / `executionFailed` / `executionRejected` 单独展示，不得因路径后来消失而改记为成功。
- 路径比较使用 `normalizeScanPath`（Windows 大小写/分隔符）。
- 普通扫描 preflight：所有确认通过后才放弃复扫上下文（`planScanPreflight` → `commitScanPreflight`）。

---

## 7. 动作白名单

本阶段普通清理**仅允许** `trash`（移入回收站）。

拒绝：`system-managed`、`manual`、`uninstall` 及非 `trash` 的 `cleanupMethod`。

---

## 8. 稳定错误码

定义于 `src/shared/cleanup-errors.ts`：

| 错误码 | 含义 |
|--------|------|
| `SESSION_STALE` | 会话过期或 fingerprint 不一致 |
| `CANDIDATE_NOT_FOUND` | 候选项不属于当前会话 |
| `SNAPSHOT_STALE` | 目标自扫描后已变化 |
| `NOT_AUTHORIZED` | 未获得清理授权 |
| `PROTECTED_PATH` | 受保护路径 |
| `ACTION_NOT_ALLOWED` | 不允许的普通删除动作 |
| `CONFIRMATION_REQUIRED` | 需要先确认计划 |
| `CONFIRMATION_EXPIRED` | 确认已过期 |
| `CONFIRMATION_ALREADY_USED` | 确认已使用 |
| `CONFIRMATION_NOT_FOUND` | 确认无效 |
| `CONFIRMATION_STORE_FULL` | 确认存储已满，无法签发新令牌 |
| `CLEANUP_PARTIAL_FAILURE` | 部分失败 |
| `CANCELLED` | 已取消 |
| `INVALID_INPUT` | 无效输入 |
| `IPC_UNAUTHORIZED` | 非可信发送方 |
| `INTERNAL_ERROR` | 内部错误 |

IPC 契约：`{ ok: true, value }` / `{ ok: false, code, message }`（不依赖 `Error.code`）。

---

## 9. 相关文件

| 文件 | 职责 |
|------|------|
| `src/shared/session-cleanup-authorization.ts` | 共享授权判定逻辑（可单测） |
| `src/main/cleanup/session-cleanup-authorizer.ts` | 会话级批量授权 |
| `src/main/cleanup/cleanup-confirmation-store.ts` | confirmationId 存储与失效 |
| `src/main/cleanup/cleanup-service.ts` | prepare / execute 编排 |
| `src/main/cleanup/cleanup-ipc.ts` | IPC 处理器与输入校验 |
| `src/main/cleanup/safety-validator.ts` | TOCTOU + 路径策略 |
| `src/main/cleanup/cleanup-execution-guard.ts` | 执行快照构造与 Cleaner 前复验 |
| `src/shared/filesystem-identity.ts` | 文件系统对象身份捕获与比对 |
| `src/renderer/cleanup-result-state.ts` | 清理结果 manifest 与复扫对比 |
| `src/renderer/post-cleanup-rescan-controller.ts` | 复扫状态机、摘要保留、重试与普通扫描分流 |
| `src/main/cleanup/cleaner.ts` | 回收站执行 |
| `src/shared/cleanup-ipc.ts` | IPC 结果类型 |
| `src/shared/cleanup-errors.ts` | 错误码与文案 |

---

## 10. 测试索引

| 测试文件 | 覆盖 |
|----------|------|
| `session-cleanup-authorization.test.ts` | 授权来源、keep/uncertain、protected |
| `cleanup-confirmation.test.ts` | 单次使用、TTL、过期、200 tombstone 满额 |
| `cleanup-execution-toctou.test.ts` | 身份 TOCTOU、目录/文件替换、symlink、多项计划 |
| `cleanup-result-lifecycle.test.ts` | manifest、prepare 拒绝与复扫对比 |
| `cleanup-snapshot-validation.test.ts` | 原子校验+快照、竞态注入、批处理隔离 |
| `cleanup-verify-directory-anchor.test.ts` | Cleaner 目录测量后 anchor 复验 |
| `cleanup-rescan-lifecycle.test.ts` | 文案 + `post-cleanup-rescan-controller` 完整生命周期 |
| `filesystem-identity.test.ts` | inode / 时间戳身份比对 |
| `session-cleanup-e2e.test.ts` | 规则 + agent-session 端到端、`applyAgentRecommendations` 生产路径、stale、复用拒绝 |
| `cleanup-integration.test.ts` | 目录快照、prepare 阶段无效 ID |
| `safety-validator*.test.ts` | 规则动作、enforcement |

所有测试仅使用临时目录或 Mock `shell.trashItem`。
