# 阶段 4 报告：单轮智能分析

> **日期**：2026-08-25
> **状态**：代码与安全复审已通过；**进行中，待最终 UI 验收**
> **明确未做**：多轮调查工具（阶段 5）、Validator 授权迁移（阶段 6）、自动清理

---

## 1. 架构与 IPC 契约

```
Renderer (finishScan → agent-analysis.ts)
    │  analyzeScan({ sessionId }) — 仅 sessionId
    ▼
Preload（invokeAgentIpc → AgentInvokeError）
    ▼
agent-ipc.ts（sender 校验 + ProviderIpcResult 风格）
    ▼
agent-service.ts
    ├─ scan-session-store（读取/更新 candidates）
    ├─ agent-prompt.ts（脱敏摘要构造）
    ├─ provider-client.chatCompletion（主进程唯一模型调用）
    ├─ agent-response.ts（JSON 校验）
    └─ agent-candidate-mapper.ts（写回 judgment / agentInsight）
```

| IPC 通道 | 入参 | 出参 |
|----------|------|------|
| `agent:analyze` | `{ sessionId: string; retry?: boolean }` | `{ analysis, items }` |

**安全边界**

- Renderer 不得传入 Candidate、路径、Prompt 或 Key
- 主进程从 `ScanSessionStore` 读取候选项
- `isTrustedMainWindowSender` 校验 IPC 发送方
- `requestId` + `latestSessionId` + `AbortController` 隔离旧会话与取消
- `chatCompletion` 接收外部 `AbortSignal`，与内部超时联动，真正终止 fetch/reader
- 每次完整扫描最多自动分析一次；`retry: true` 可复用当前 `sessionId` 重试

---

## 2. 隐私脱敏规则

| 规则 | 实现 |
|------|------|
| 用户目录 | `<USER_HOME>`（任意位置，大小写不敏感） |
| Windows | `<WINDOWS>` |
| Program Files | `<PROGRAM_FILES>` / `<PROGRAM_FILES_X86>` |
| 盘符根 | `<DRIVE>`（层级摘要） |
| 嵌入绝对路径 | `sanitizeFreeText()` 整体替换为 `<PATH>` |
| UNC 路径 | `\\server\share\...` → `<PATH>` |
| 用户名 | 替换为 `<USER>` |
| 控制字符 | 折叠为空格 |
| 禁止发送 | Key、文件内容、原始绝对路径、shell/删除命令 |

`sanitizeHierarchyPath()` 用于层级摘要；`sanitizeFreeText()` 用于 reason/evidence/impact 等自由文本。

**资源上限**（`src/shared/agent-limits.ts`）

- 最多 200 个 Candidate
- 请求摘要 ≤ 128 KiB
- 每项最多 8 条 evidence
- 文本字段 ≤ 256 字符
- 模型响应受 Provider `RESPONSE_TOO_LARGE` 保护

---

## 3. Prompt 输入与输出 Schema

**输入**：`candidateRef`、类型、逻辑大小、扩展名/时间分布、层级摘要、`snapshotComplete`、本地特征、脱敏 evidence。

**输出**（`schemaVersion: "1"`）：

```json
{
  "schemaVersion": "1",
  "summary": { "headline": "...", "overview": "..." },
  "recommendations": [{
    "candidateRef": "candidate-1",
    "verdict": "clean | confirm | keep | uncertain",
    "likelyContent": "...",
    "reason": "...",
    "impact": "...",
    "confidence": "high | medium | low",
    "basis": ["..."]
  }]
}
```

模型不得返回路径、删除命令或执行授权字段。空间大小以本地 Candidate 为准。

---

## 4. Candidate 映射规则

| verdict | judgment.status | UI 分类 |
|---------|-----------------|---------|
| clean | suggested | 建议清理 |
| confirm | caution | 谨慎处理 |
| keep | keep | 建议保留 |
| uncertain | uncertain | 待判断 |

- `judgment.source = "agent"`
- `agentInsight` 保存 likelyContent / reason / impact
- **不覆盖**：id、path、size、snapshotComplete、mtime、entryKind、parentTarget、ruleId
- **Analyzer-only**：即使 Agent 建议 clean，仍 `selectable=false`
- **规则项**：不得扩大 `deletable`；keep/uncertain 保守禁止选择
- Agent 重绘后 `reconcileAfterAgentUpdate()` 移除不可选项勾选；`updateSelectedSummary()` 同时过滤 `isSelectable()`

---

## 5. 失败 / 取消 / 重试

| 场景 | 行为 | Agent 错误码 |
|------|------|--------------|
| 无 Key | 跳过分析，扫描结果保留，提示前往设置 | —（`skipped_no_provider`） |
| 模型超时 | 扫描结果保留，显示连接超时 +「重试分析」 | `TIMEOUT` |
| 模型失败 | 扫描结果保留，显示错误 +「重试分析」 | `NETWORK_ERROR` / `RESPONSE_INVALID` 等 |
| 新扫描开始 | `AbortController` 终止旧网络请求；旧响应不覆盖新会话 | `SESSION_STALE` |
| 主动取消分析 | 终止进行中的模型请求 | `CANCELLED` |
| 用户停止扫描 | 保留已发现结果，**不调用模型**；显示「扫描已停止，未运行智能分析」 | —（`cancelled` UI 状态） |
| 重试 | `retry: true`，同一 `sessionId`，运行中不得并发 retry | — |

Provider `TIMEOUT` 映射为 Agent `TIMEOUT`（非 `NETWORK_ERROR`）；Provider `CANCELLED` 映射为 Agent `CANCELLED`。超时与取消通过首次触发原因区分，不会互串。

| 分析重绘 | 保持分类 Tab、合法勾选状态、`#panel-clean` scrollTop |

Renderer 侧 `analysisGeneration` token 防止旧异步回调覆盖新扫描 UI。

---

## 6. 复审与人工验收进度

### 代码与安全复审（已通过）

- AbortSignal 真正取消网络请求
- Renderer 新旧会话竞态防护（`analysisGeneration` token）
- Prompt 路径脱敏（嵌入路径、UNC、盘符、用户名）
- Agent 改判后勾选协调
- 取消扫描不自动分析
- `TIMEOUT` / `CANCELLED` / `SESSION_STALE` 错误码契约

### 人工 UI 验收

| 场景 | 状态 |
|------|------|
| 无 Key 降级 | 通过 |
| 鉴权失败且扫描结果保留 | 通过 |
| 失败与重试 UI | 通过 |
| 成功分析 UI（本地 Mock Provider） | **待验收** |

阶段 4 仍为 **进行中，待最终 UI 验收**。

### 非阻断 UI 文案观察（本次仅记录，未修改）

1. 智能分析失败时，可补充「本地规则建议仍可使用」类提示。
2. 候选项内容类型「AI / Agent」易被理解为判断来源；后续建议改为「AI 工具缓存」或「AI 应用数据」。

---

## 7. 第二轮整改与测试

| 整改项 | 主要文件 |
|--------|----------|
| AbortSignal 真正取消网络请求 | `provider-client.ts`、`agent-service.ts`、`provider-types.ts` |
| Renderer 会话竞态 | `agent-analysis.ts` |
| Prompt 脱敏补全 | `path-sanitize.ts`、`agent-prompt.ts` |
| Agent 改判后勾选协调 | `candidate-selection-state.ts`、`main.ts` |
| 取消扫描不自动分析 | `agent-analysis.ts`、`main.ts` |

| 检查项 | 结果 |
|--------|------|
| `npm test` | **217** 项通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `git diff --check` | 通过 |

**新增/扩展测试**：`provider-client`（外部 signal 取消、首次触发原因）、`agent-service`（`TIMEOUT`/`CANCELLED`/`SESSION_STALE` 契约）、`agent-ipc-security`（IPC 层错误码透传）、`agent-analysis`（竞态/取消）、`agent-prompt`（嵌入路径/UNC）、`candidate-selection-state`（Agent 改判后勾选）。

---

## 8. 与后续阶段区分

| 能力 | 阶段 4 | 阶段 5 | 阶段 6 |
|------|--------|--------|--------|
| 单轮分析建议 | ✅ | — | — |
| 多轮只读调查 | — | 计划 | — |
| 工具调用 | — | 计划 | — |
| Validator 会话授权 | — | — | 计划 |

---

## 9. 人工 UI 验收清单

- [ ] 扫描完成 →「Agent 正在分析」→「智能建议已生成」（**待 Mock Provider 验收**）
- [x] 无 Key 时显示「未配置模型…」+ 前往设置
- [ ] 每条候选项展示 Agent 建议、理由、影响、置信度、来源（**待 Mock Provider 验收**）
- [x] 失败后可「重试分析」，扫描结果不丢失
- [ ] 停止扫描后显示「未运行智能分析」，不产生模型请求
- [ ] 增量扫描批次不重复请求模型
- [ ] 分析后分类/合法勾选/滚动位置保持
- [ ] Agent keep 后不可选项不再显示为已勾选
- [ ] 无「自动删除」类文案
- [ ] 1366×768 / 1920×1080 无嵌套滚动

---

阶段 4 路线图：**进行中，待最终 UI 验收**。
