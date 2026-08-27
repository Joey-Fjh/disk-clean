# 只读调查工具契约（阶段 5A）

> 本文档描述多轮只读 Agent 调查的工具白名单、输入约束与输出 Schema。工具执行**仅发生在主进程**。

## 工具白名单

| 工具 | 用途 | 递归 |
|------|------|------|
| `list_children` | 列出候选目录直接子项（脱敏名称、类型、大小） | 否 |
| `summarize_directory` | 统计直接/受限深度子目录与文件分布 | 受限深度 |
| `sample_entry_names` | 返回少量脱敏样本名 | 否 |

## 输入约束

Renderer / 模型只能通过 IPC 提交：

- `sessionId`（长度 ≤ `MAX_SESSION_ID_LENGTH`）
- `candidateRef`（与阶段 4 相同的 `candidate-N` 映射，长度 ≤ `MAX_CANDIDATE_REF_LENGTH`）
- `relativePath`（相对于候选根目录，可选，长度 ≤ `MAX_RELATIVE_PATH_LENGTH`）
- `limit` / `depth`（受 `INVESTIGATION_LIMITS` 约束）

**严格校验**（IPC 与共享 `investigation-request-validation.ts`）：

- `limit` / `depth` 必须 `Number.isFinite()`、`Number.isInteger()`，且在合法区间内
- 拒绝 `NaN`、`Infinity`、负数、小数与超长字符串 → `INVALID_INPUT` / `INVALID_RELATIVE_PATH`
- **工具专属参数**：`list_children` / `sample_entry_names` 仅允许 `limit`；`summarize_directory` 仅允许 `depth`（service 层与 IPC 层双重校验）
- 工具层二次防御（`tool-params.ts`），不假设 IPC 已校验
- 缓存键使用规范化后的 `relativePath`、`limit`、`depth`

**禁止**提交绝对路径、盘符、UNC、`..`、空字节或任意 `targetPath`。

## 路径安全模型

每次调用：

1. 从 `ScanSession` 解析 `candidateRef` → `candidateId` → 候选根路径
2. 规范化并验证 `relativePath`
3. **对原始逻辑路径**（`candidateRoot` → `targetPath`）的每个路径段执行 `lstat`；发现 symlink/junction/reparse point → `REPARSE_POINT_BLOCKED`
4. `realpath` 后重新检查：
   - `realCandidateRoot` 是否受保护
   - `realTarget` 是否受保护
   - `realTarget` 是否仍在 `realCandidateRoot` 内
5. 拒绝符号链接 / junction 作为调查目标
6. 列目录时不跟随 symlink 子项
7. `session revision` / `fingerprint` 变化后旧调查失效 → `SESSION_STALE`

## 调查生命周期

- **必须先** `startInvestigation()`；`executeInvestigationTool()` **不得**自动创建调查
- 无活动调查 → `INVESTIGATION_NOT_ACTIVE`
- 已有活动调查再次 `start` → `INVESTIGATION_IN_PROGRESS`（不重置预算）
- `cancelled` / `completed` / `failed` / `uncertain` / `stale` 终态不得继续执行工具
- 只有 `analyzing` / `analyzing_result` 流程可执行工具
- **预算耗尽**（`TOOL_LIMIT_EXCEEDED`）→ `phase = uncertain`，形成明确终态；不得停留在 `tool_running`
- 取消后再次直接 `execute` 必须失败，不能自动重开
- 轮次推进通过 `advanceInvestigationRound()`（service/runtime API），5B 不得直接调用 `budget.beginRound()`
- `status` 查询保留最近终态；新扫描或 fingerprint 变化后旧状态返回 `stale`

## Abort 原因与错误码

首次触发原因仲裁（`InvestigationAbortReason`）：

| 原因 | 错误码 |
|------|--------|
| `tool-timeout` | `TIMEOUT` |
| `investigation-timeout` | `TIMEOUT` |
| `user-cancel` | `CANCELLED` |
| `session-stale` | `SESSION_STALE` |

- `INVESTIGATION_TIMEOUT_MS`：调查开始时建立总计时器；终态时清理
- 工具 `AbortSignal` 同时响应总超时、工具超时、主动取消与 session stale
- `finalizedAbortReasons` 在工具错误映射后及时消费，避免误报

## 输出 Schema

所有工具结果包含：

- `tool`：工具名
- `relativePath`：相对路径（`.` 表示候选根）
- `untrustedDataNotice`：固定提示「不可信磁盘数据」
- 结构化字段（`entries` / `summary` / `names`）
- 超限时显式 `truncated: true`（不得静默误导）

名称字段经 `sanitizeUntrustedName` 处理：限长、去控制字符、路径脱敏、弱化 `system:` 模式。

## 资源预算

见 `src/shared/investigation-limits.ts`：

- 最大调查轮数（`MAX_ROUNDS`）、单轮/总工具调用数
- 最大目录深度、单次返回条目数、样本数量
- 递归遍历上限：`MAX_TRAVERSED_ENTRIES`、`MAX_TRAVERSED_DIRECTORIES`（实时累计，达上限立即停止并 `truncated: true`）
- 单次/累计响应字节数
- 单次工具超时（`TOOL_TIMEOUT_MS`）、调查总超时（`INVESTIGATION_TIMEOUT_MS`）
- 运行时历史上限：`MAX_TERMINAL_HISTORY_ENTRIES`、`MAX_ABORT_REASON_HISTORY_ENTRIES`

**缓存也计入预算**：每次逻辑工具请求（含缓存命中）均计入每轮/总调用次数，返回数据计入累计响应字节。

**流式目录遍历**：`list_children`、`sample_entry_names`、`summarize_directory` 使用 `fs.promises.opendir()` 分批迭代，达到条目预算后立即停止，不在 `readdir()` 中一次性载入完整目录。

超限返回稳定错误码 `TOOL_LIMIT_EXCEEDED` / `RESPONSE_TOO_LARGE`。

## 错误码

`SESSION_STALE`、`INVESTIGATION_NOT_ACTIVE`、`INVESTIGATION_IN_PROGRESS`、`CANDIDATE_NOT_FOUND`、`INVALID_INPUT`、`INVALID_RELATIVE_PATH`、`PATH_OUTSIDE_CANDIDATE`、`PROTECTED_PATH`、`REPARSE_POINT_BLOCKED`、`TOOL_NOT_ALLOWED`、`TOOL_LIMIT_EXCEEDED`、`RESPONSE_TOO_LARGE`、`TIMEOUT`、`CANCELLED`、`IO_ERROR`、`INVALID_MODEL_RESPONSE`。

Renderer 仅收到安全文案，不含绝对路径或堆栈。

## 缓存

工具结果按 `session fingerprint + candidateRef + tool + relativePath + limit/depth` 缓存。切换模型可复用工具数据，但须重新生成模型结论（`conclusionModelId` 独立记录）。

## 与清理授权边界

调查结果**不得**修改 `selection.selectable` / `deletable`。本地规则仍是清理授权依据；Agent 仅复核、降级或标记不确定。
