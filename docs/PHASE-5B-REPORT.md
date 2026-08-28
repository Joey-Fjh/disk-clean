# 阶段 5B 交付报告：多轮只读 Agent 调查编排与调查过程 UI

> **状态**：**已完成**（2026-08-27 针对性复审通过）

> **HEAD**：`a690175`（工作区含未提交的阶段 4.2 / 5A / 3.1 / 5B 改动，未 commit）

> **下一阶段**：阶段 6（Validator 会话授权迁移）；UI 集中调整仍延后

---

## 1. Git HEAD 与工作区

| 项 | 值 |
|----|-----|
| HEAD | `a690175` |
| 工作区 | 阶段 4.2 + 5A + 3.1 + **5B** 全部保留于工作区 |
| commit / push | **未执行** |

---

## 2. 多轮编排架构

`runAgentAnalysis()` 为唯一入口；有 Key 时委托 `runInvestigationOrchestration()`：

1. 建立 canonical `candidateRef` 并注册到调查运行时
2. `startInvestigation()` 启动 5A 运行时与预算
3. 循环：模型调用 → 解析 `investigate` / `final` / `legacy-final`
4. `investigate`：主进程自动执行只读工具 → `advanceInvestigationRound()`
5. 终态：`completeInvestigation()` → `applyAgentRecommendations()` 一次性写回 Candidate

详见 [INVESTIGATION-ORCHESTRATION.md](./INVESTIGATION-ORCHESTRATION.md)。

---

## 3. canonical candidateRef 修复（P0）

**问题**：`agent-prompt.ts`、`candidate-ref.ts` 按 session 插入顺序编号，而 `agent-candidate-prep.ts` 按优先级重编号，导致 `candidate-1` 错配。

**修复**：`src/shared/candidate-ref-index.ts` 提供单一索引；排序只改变调查优先级，不改变 ref 编号。回归测试：`tests/candidate-ref-index.test.ts`。

---

## 4. 模型回合 Schema

`investigation-turn-parser.ts` 严格校验：

- `investigate`：`purpose` + `calls[]`（工具白名单、相对路径、无绝对路径注入）
- `final`：嵌套 `AgentModelResponse v1`
- `legacy-final`：兼容旧单轮格式
- `parseNativeToolCalls()`：兼容原生 `tool_calls`

---

## 5. 自动候选策略

`buildAgentInvestigationCandidates()` 使用 canonical ref；`denyRead` 项排除；`readOnlyHighRisk` 允许只读调查但不授予删除权限。

---

## 6. Profile 快照与缓存复用

调查启动时快照 active Profile；运行中切换不影响当前轮；重试取最新 Profile；工具缓存按 fingerprint 复用，模型结论不复用。

---

## 7. 取消 / 超时 / 失效

- `cancelAgentAnalysis()` + `agent:cancel-analysis` IPC + UI「停止智能分析」
- `CANCELLED` vs `SESSION_STALE` 分离
- 编排器 `try/catch` 清理调查运行时；`finalizeTerminal` 清除 investigation 定时器

---

## 8. 时间线 UI

- 横幅内 `#agent-investigation-timeline` 列表
- `onInvestigationTimeline` 订阅 + IPC 返回值 `investigation.timeline`
- `textContent` 渲染、最大 48 条、generation/session 竞态过滤
- 增量更新保持 `#panel-clean` scrollTop

---

## 9. 安全边界

| 允许 | 禁止 |
|------|------|
| 多轮模型 + 5A 三工具 | Shell / 写入 / 删除 / 读文件正文 |
| 自动调查候选 | 绝对路径参数 / 扩大 selectable |
| 建议写回（终态一次） | Validator 授权变更 / 规则自动生成 |

---

## 10. 测试

| 类别 | 文件 |
|------|------|
| canonical ref | `candidate-ref-index.test.ts` |
| 回合解析 | `investigation-turn-parser.test.ts` |
| 两轮 / 单轮编排 | `investigation-orchestrator.test.ts` |
| 时间线 Renderer | `agent-investigation-timeline.test.ts` |
| 既有回归 | 全部 102 文件通过 |

**总测试数**：**438**（针对性复审后；含时间线绑定、生命周期回调、ref map 释放等边界测试）

---

## 11. 验证结果

| 命令 | 结果 |
|------|------|
| `npm test` | ✅ 438 passed |
| `npm run typecheck` | ✅ |
| `npm run build` | ✅ |
| `git diff --check` | ✅（仅 CRLF 提示） |

### 复审记录

| 轮次 | 结果 | 要点 |
|------|------|------|
| 首轮 | 未通过 | generation 不一致、预算耗尽误报、取消 IPC/任务态、候选未送入模型等（已整改） |
| 二轮 | 未通过 | 重试生命周期、取消文案、时间线重复、白名单未收窄、ref 累积（已整改） |
| 针对性复审 | **通过** | 权威快照绑定、ref map `finally` 覆盖初始化路径；无阻断问题 |

---

## 12. 未进入阶段 6

未修改 `CleanupPlan` / `SafetyValidator` 授权模型；无会话候选授权迁移；无自动删除。

---

## 13. 人工截图验收清单

- [ ] 扫描完成后自动进入智能分析，横幅显示调查时间线
- [ ] 时间线出现「正在分析 N 个高占用位置」「正在查看 candidate-X 的目录构成」等步骤
- [ ] 点击「停止智能分析」后显示已停止，本地规则结果仍可用
- [ ] 失败后「重试分析」不要求重新扫描
- [ ] 分析完成后「正在分析」临时分类消失，回到 5 分类
- [ ] 时间线无绝对路径、无 API Key、无原始模型正文
- [ ] 切换 Profile 后重试使用新模型；同 fingerprint 工具缓存仍命中
- [ ] 无 Key 时不出现调查时间线

---

**未 commit · 未 push · 阶段 5B：已完成 · 阶段 5 整体：已完成**
