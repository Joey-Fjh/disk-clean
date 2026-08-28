# 多轮调查编排（阶段 5B，已完成）

> 本文档描述主进程如何将单轮 Agent 分析扩展为多轮只读调查循环。工具契约与安全边界见 [INVESTIGATION-TOOLS.md](./INVESTIGATION-TOOLS.md)（5A）。

## 流程概览

```
扫描 → 本地整理 → runAgentAnalysis()
                      ├─ 无 Key：跳过模型与调查
                      └─ 有 Key：runInvestigationOrchestration()
                            ├─ 建立 canonical candidateRef 索引
                            ├─ startInvestigation()
                            ├─ 模型回合（investigate | final | legacy-final）
                            ├─ 自动执行只读工具（主进程）
                            ├─ advanceInvestigationRound()
                            └─ completeInvestigation()
                      → applyAgentRecommendations()（仅终态写回）
```

Renderer **只**发起 `agent:analyze`（sessionId 级），不解析模型响应、不调用调查工具。

## canonical candidateRef

同一 `sessionId + revision` 内，以下路径共享 `buildCandidateRefIndex()` 生成的 `refToId` / `idToRef`：

- `buildAgentMessages()` / Prompt
- `buildAgentInvestigationCandidates()`（排序仅影响调查优先级，**不重新编号**）
- `resolveCandidateByRef()`（通过 `registerCandidateRefMap(fingerprint)`）
- `applyAgentRecommendations()`

`revision` 变化后旧映射失效；新扫描须重新注册。

## 模型回合 Schema（content JSON）

### 请求调查

```json
{
  "schemaVersion": 1,
  "action": "investigate",
  "purpose": "需要确认该目录主要包含哪些类型的数据",
  "calls": [
    {
      "candidateRef": "candidate-7",
      "tool": "summarize_directory",
      "relativePath": ".",
      "depth": 1
    }
  ]
}
```

### 最终结论

```json
{
  "schemaVersion": 1,
  "action": "final",
  "result": { "...AgentModelResponse v1..." }
}
```

### 兼容

- 无 `action` 字段的 **AgentModelResponse v1** 视为 `legacy-final`（单轮直出）。
- 若 Provider 返回原生 `tool_calls`，`parseNativeToolCalls()` 转为等价的 `investigate` 回合；content JSON 协议始终可用。

**禁止**：`sessionId`、`candidateId`、绝对路径、盘符、`targetPath`。非法请求不接触文件系统。

## Profile 快照

- 调查启动时 `requireRunnableConfig()` 快照 active Profile（id / baseUrl / model / apiKey）。
- 运行中切换 Profile **不影响**当前请求。
- 重试时使用**当时最新** active Profile。
- 工具缓存按 `fingerprint` 复用；模型结论**不**跨 Profile 复用。

## 取消与失效

统一入口 `cancelAgentAnalysis()`：

- 终止 Agent 网络请求（`AgentAnalysisState.abortController`）
- 终止调查运行时（`InvestigationRuntime.cancelActive()` + `cancelInvestigation()`）

| 场景 | 错误码 |
|------|--------|
| 用户主动停止 | `CANCELLED` |
| 新扫描 / revision 变化 | `SESSION_STALE` |
| 预算 / 轮次耗尽 | `uncertain` 终态 |
| 模型 / 工具超时 | `TIMEOUT` |

## 时间线事件

主进程通过 `agent:investigation-timeline` 推送脱敏事件；Preload 仅暴露 `onInvestigationTimeline` 订阅。

事件类型：`investigation_started` · `model_analyzing` · `tool_requested` · `tool_completed` · `planning` · `completed` · `uncertain` · `failed` · `cancelled`

IPC 返回值 `AgentAnalyzeResult.investigation` 含完整时间线摘要，避免漏掉最后事件。

## 模块索引

| 模块 | 职责 |
|------|------|
| `candidate-ref-index.ts` | canonical ref 索引 |
| `investigation-turn-parser.ts` | 回合 Schema 校验 |
| `investigation-orchestrator.ts` | 多轮编排主循环 |
| `investigation-timeline-bus.ts` | 时间线收集与 IPC 推送 |
| `agent-service.ts` | 统一 `runAgentAnalysis()` 入口 |

## 阶段边界

**未实现**：Shell、文件写入/删除、规则自动生成。Validator 会话授权已迁移至阶段 6（见 [SESSION-CLEANUP-AUTHORIZATION.md](./SESSION-CLEANUP-AUTHORIZATION.md)）。

Agent 结论仅改变建议、理由、影响、把握与展示分类，不得扩大本地清理权限。
