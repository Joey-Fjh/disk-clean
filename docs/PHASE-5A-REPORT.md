# 阶段 5A 交付报告（多轮只读 Agent 调查基础设施）

**阶段名称**：多轮只读 Agent 调查基础设施（5A）  
**状态**：**已完成，代码与安全复审通过**  
**日期**：2026-08-27  
**Git 基线 HEAD**：`87fddcc`（阶段 4.1 已完成）  
**提交**：阶段 5A 本地 commit（未 push）

---

## 最后一轮整改摘要

| 问题 | 整改 |
|------|------|
| P0：`reserveToolCall()` 在 try 外导致 `tool_running` 僵尸 | 统一异常收口；`TOOL_LIMIT_EXCEEDED` → `uncertain` 终态；`rollbackToolPhase()` 兜底 |
| P1：`readdir()` 一次性载入大目录 | `directory-iterator.ts` + `opendir()` 流式迭代，达预算即停 |
| P1：路径段检查使用 realpath 折叠 junction | 对原始逻辑路径段 `lstat` 后再 `realpath` 复检 |
| P1：`terminalByKey` / `finalizedAbortReasons` 无限增长 | 历史上限 + 新扫描清理 + `consumeAbortReason()` |
| — | 工具专属参数 service 层校验 |
| — | `advanceInvestigationRound()` 封装轮次推进 |

---

## 代码审计与复用

| 既有机制 | 复用方式 |
|----------|----------|
| `ScanSession` + `revision` + `fingerprint` | 调查失效检测、工具结果缓存键 |
| `candidate-${n}` 映射（`agent-prompt.ts`） | `candidate-ref.ts` 统一解析 |
| `isProtectedPath` / `path-utils` | 工具路径边界 |
| `path-sanitize.ts` | 工具结果脱敏 |
| `AgentAnalysisState` 模式 | `InvestigationRuntime`（AbortController、单活动调查） |
| `agentIpcOk/Fail` + trusted sender | `investigation-ipc.ts` |

**未复制第二套会话体系**——调查挂在现有 `ScanSession` 与 fingerprint 上。

---

## 调查状态机

纯逻辑：`src/shared/investigation-state-machine.ts`

运行时：`src/main/agent/investigation/investigation-runtime.ts`

- 同一 session 仅一个活动调查；重复 `start` → `INVESTIGATION_IN_PROGRESS`
- 预算耗尽 → `uncertain` 终态，不得卡在 `tool_running`
- 轮次推进：`advanceInvestigationRound()`（内部 `beginRound()`）
- 终态持久化 + 历史上限；Abort 原因消费后删除

---

## 测试

| 文件 | 覆盖 |
|------|------|
| `tests/investigation-lifecycle.test.ts` | 僵尸状态修复、预算终态、轮次 API、工具参数 |
| `tests/investigation-directory-iterator.test.ts` | 流式迭代未读完整目录 |
| `tests/investigation-path-junction.test.ts` | 逻辑路径段 junction / protected alias |
| `tests/investigation-runtime-history.test.ts` | 终态历史上限与清理 |
| `tests/investigation-request-validation.test.ts` | 工具专属参数拒绝 |
| 及其他 investigation-* 测试 | 安全、预算、IPC、状态机 |

**总测试：350 项通过**

---

## 留给 5B

- 多轮模型编排（tool_calls 循环、`chatCompletion` 多轮消息）
- 调查时间线 UI
- 单轮分析不足时自动触发调查
- 完整验收与端到端 Mock Provider 多轮测试

---

## 验证

```text
npm test          # 350 passed
npm run typecheck # pass
npm run build     # pass
git diff --check  # pass (CRLF warnings only)
```

**未 push。阶段 5B 已完成；阶段 5 整体已完成。**
