# 产品决策

记录讨论结论，方便换电脑后继续。

最后更新：2026-08-27

---

## 分阶段协作流程（2026-08-25）

1. 产品审核当前阶段实现。
2. 审核通过后，产品提供下一阶段 Prompt。
3. 编码 Agent **只实现该阶段**，不跨阶段。
4. 完成后交付代码与执行报告，产品复审；通过后再标记路线图完成并进入下一阶段。

---

## 阶段 2 迁移期双轨说明（2026-08-25）

**产品直觉（正确）**：终态是「扫盘 → LLM 判断」，JSON 规则降为证据层；规则扫描不应作为永久主流程。

**当前实现（迁移桥）**：在 Agent 未接入前，保留 `RuleScanner` 产出可清理项，否则全部 pending、无法清理。空间发现项为 `pending`；规则命中项为 `suggested`/`caution` 且可走现有 Validator。

**何时改变**：阶段 6 已完成 Validator 会话授权迁移；规则扫描逐步降为证据补充。

阶段 2 已于 2026-08-25 验收通过。

---

## 阶段 3：模型 Provider 与安全凭证（2026-08-25，已完成）

| 决策 | 说明 |
|------|------|
| 凭证存储 | Electron `safeStorage` + **keyOrigin 绑定**；跨 Origin 变更须重输 Key（`KEY_REENTRY_REQUIRED`） |
| safeStorage 不可用 | 拒绝保存 Key，向用户说明；**不降级**为明文 |
| Renderer 可见信息 | 仅 `hasKey`、`keyLastFour`；无解密 IPC |
| 第一版协议 | OpenAI-compatible Chat Completions；预设 OpenAI / DeepSeek / Custom |
| 连接测试 | 最小 Chat 请求（`ping`），非 `/models` |
| 能力测试 | 固定 JSON 提示，本地解析；不发送扫描/Candidate 数据 |
| 未做 | 多轮调查工具、扫描中增量调用模型、Validator 授权迁移（阶段 5+ / 6） |

### 阶段 3.1：多模型配置管理（2026-08-27，已完成）

| 决策 | 说明 |
|------|------|
| 存储 | `provider-config.json` schema **v2**：`profiles[]` + `activeProfileId` |
| 迁移 | 阶段 3 单配置幂等迁移为一份默认 Profile；保留既有密文与 keyOrigin |
| 多 Profile | 每份独立 Provider / URL / 模型 / Key；最多 20 份；ID 主进程生成 |
| active | Agent 与规则草稿 Agent 仅使用 **active Profile**；无 Key 不自动 fallback |
| 删除 | 删除整份 Profile（含 Key）；不再在测试区提供「删除 Key」 |
| Renderer | 列表/表单安全 DOM；测试仅传 `profileId` |
| 延后 | 扫描详情过重、空「正在分析」Tab、任务与分类生命周期同步（见 PHASE-3.1-REPORT） |

详见 [PHASE-3.1-REPORT.md](./PHASE-3.1-REPORT.md)。

### 阶段 4 单轮智能分析（2026-08-26，已完成）

代码与安全复审、人工 UI 验收（含本地 Mock Provider）均已通过。

| 项 | 说明 |
|----|------|
| 单轮分析 | 扫描完成后主进程发起一次模型分析；Renderer 仅传 `sessionId` |
| 脱敏 Prompt | 路径/用户名脱敏；candidateRef 映射；128 KiB / 200 项上限 |
| 结构化输出 | schema v1 JSON 校验；verdict → judgment 映射 |
| 安全约束 | Analyzer-only 不可因 Agent 变为可清理；不扩大规则权限 |
| UI | 分析横幅、Agent 建议展示、失败重试；保持滚动/分类/勾选状态 |

详见 [PHASE-4-REPORT.md](./PHASE-4-REPORT.md)。**阶段 5** 才包含多轮只读调查与工具调用；**阶段 6** 才迁移 Validator 会话授权。

---

## 已确认：Agent 驱动目标方案（2026-08-24）

以下决策描述 **目标产品方向**，完整设计见 [PRODUCT-AGENT-DESIGN.md](./PRODUCT-AGENT-DESIGN.md)，分阶段实施见 [AGENT-ROADMAP.md](./AGENT-ROADMAP.md)。

| 决策 | 说明 |
|------|------|
| 采用 Agent 驱动路线 | Disk Clean 定位为 Agent 驱动的 Windows 磁盘清理工具；**Agent 是清理方案的主要判断者**，综合扫描信息与本地证据形成建议 |
| 空间分析并入统一流程 | 「空间分析」不再是独立用户模式，而是同一清理流程的**前置节点** |
| 第一版模型接入 | 用户自备 **API Key**，在应用内独立调用模型；不依赖外部 Codex / Cursor |
| 参考 CC-Switch | 借鉴 Provider 预设、地址处理、协议兼容、模型映射与连接检测思路；**不依赖** CC-Switch 运行时 |
| JSON 定位为证据层 | 规则 JSON 为**识别证据、保护信息与经验提示**；**不是**主要决策入口或执行必要条件 |
| Agent 自动分析 | Agent **自动**形成整体清理判断；可优先深入大型/异常目录，**不限于**未匹配 JSON 的项 |
| 执行授权 | 阶段 6 已迁移为会话候选项授权（`agent-session` + `local-rule` + `confirmationId`）；见 [SESSION-CLEANUP-AUTHORIZATION.md](./SESSION-CLEANUP-AUTHORIZATION.md) |
| 无法确定不可删 | 「无法确定」项默认**不可选择清理** |
| 只读调查工具 | Agent 仅可使用**受限、只读**的调查工具；无 Shell、无任意删除 |
| 确认与执行不可绕过 | 用户确认 + `SafetyValidator` + 本地 Cleaner 为硬性门槛；模型不能绕过 |
| 模型与安全分离 | 模型差异只影响**建议质量**，不能改变 **protectedPaths、会话授权、Validator** 等安全底线 |
| 隐私默认 | 默认不向模型发送文件正文；路径脱敏；Key 不进日志与导出 |

**推荐界面文案**：「Agent 自动分析并制定清理方案，由你确认后安全执行。」
**避免**：「AI 自动删除」。

---

## 阶段 2 已落地：Candidate 判断模型（2026-08-24）

当前 `ScanItem` 承载统一 Candidate，区分「发现了什么」「掌握了什么证据」「是否已判断」「用户是否可勾选」：

| 概念 | 字段 / 取值 |
|------|-------------|
| 发现来源 | `discoverySources[]`：`space-scan` / `rule` / `local-feature` / `agent` |
| 判断状态 | `judgment.status`：`pending` / `suggested` / `caution` / `keep` / `uncertain` |
| 判断来源 | `judgment.source`：`legacy-rule` / `agent` / `local-policy` / `none` |
| 判断依据 | `judgment.basis[]` + `evidence[]` |
| 把握程度 | `judgment.confidence` |
| 用户选择 | `selection.selectable` + `notSelectableReason` |
| 建议动作 | `suggestedAction`（白名单；本阶段不扩展 Cleaner） |

**当前行为**：

- 空间发现项 → `pending`，不可勾选，文案「当前版本尚未启用智能判断，仅展示空间占用」。
- Legacy 规则项 → `suggested` / `caution` / `keep`，仍同步 `deletable` / `ruleId` 供 `SafetyValidator`。
- 同路径合并 → `mergeScanCandidates()` 保留双方证据，规则判断驱动执行字段。
- **未接入 LLM、未修改 Validator 授权。**

纯函数入口：`src/shared/candidate-model.ts`（`normalizeCandidate`、`mapSpaceScanItem`、`mapRuleScanItem`、`mergeScanCandidates`）。

---

## 当前实现（规则驱动 v0.x）— 待迁移

> 以下描述 **当前代码中的真实行为**，在 Agent 路线图完成前仍然有效。与目标方案冲突处以「待迁移」标注。

### 定位（当前实现）

做 **磁盘空间分析 + 规则驱动安全清理** 的 Windows 本地工具。

> Disk Clean（当前）= 空间发现器 + **规则解释器** + 风险决策层 + 可审计清理执行器

**待迁移**：长期定位调整为「Agent 调查与方案 + 本地安全执行」（见上节）。

参考对象：火绒 / 电脑管家的清理模块——强调**透明**：每项展示原因、影响、风险，用户确认后才删除。

### 第一性原则（延续）

**扫描尽量全面，删除必须保守。**

```
发现占用 → 识别内容 → 判断风险 → 用户选择 → 安全清理 → 记录结果
```

执行链路（当前与未来均适用）：

```
Candidate → CleanupPlan → SafetyValidator → Cleaner
```

不是 `Rule → fs.rm()`。

### 核心流程（当前实现）

```
选择盘符 → 开始扫描（统一入口）
   ↓
空间发现（DiskAnalyzer）→ 规则识别（RuleScanner）
   ↓
合并去重（同路径合并 Candidate 证据）→ 单一 ScanSession
   ↓
三档风险 UI
   ↓
用户选择 → CleanupPlan → SafetyValidator（当前：须匹配规则）→ 回收站
```

### 扫描编排（当前实现）

```
ScanEngine（默认 mode = combined）
├── 阶段 1：DiskAnalyzer — 空间占用发现（仅分析项，deletable: false）
└── 阶段 2：RuleScanner — 按启用 JSON 规则生成可清理候选项
```

内部仍保留 `quick` / `full` 遗留模式（测试与兼容），用户界面不再暴露。

**阶段 6 已完成**：Validator 已迁移为会话候选项授权；规则/JSON 逐步降为证据层（阶段 7 深化经验库）。

### 三档风险（当前 UI）

| 档位 | 内部 ID | UI 文案（当前） | 含义 | UI 策略 |
|------|---------|----------------|------|---------|
| 低风险 | safe | 建议清理 | 明确缓存 / 临时文件 | 默认可勾选 |
| 需确认 | recommended | 谨慎处理 | 可重新生成，但有成本 | 默认不勾选 |
| 仅查看 | dangerous | 仅分析 | 用户/系统/状态数据 | 只展示，不删除 |

**目标方案**将统一为：建议清理 / 需要确认 / 空间占用·无法确定（见 PRODUCT-AGENT-DESIGN §8），迁移期可保留现有 Tab。

### 数据性质分类（contentType）

按数据性质分类，而非按「开发工具」作为产品核心：

| 类型 | 说明 |
|------|------|
| system-temp | 系统临时文件 |
| browser-cache | 浏览器缓存 |
| app-cache | 应用缓存 |
| app-logs | 应用日志 |
| download-leftover | 下载残留 |
| system-protected | 系统受保护数据 |
| large-dir | 大型目录（空间分析） |
| developer / agent / chat | 扩展分类 |

### 安全底线（当前与未来均适用）

#### protectedPaths

- 配置在 `config/protected-paths.json`
- 使用 `%SystemDrive%`、`%SystemRoot%` 等环境变量，不写死盘符
- **允许扫描统计，禁止 Cleaner 删除**

#### 其他

- 删除优先进回收站，不直接永久删除
- 不跟随 symlink / junction 递归（宁愿漏掉，不能越界）
- 自定义规则 JSON 只允许声明式字段，禁止 `command` / `exec` 等
- 权限拒绝：跳过并记录，不中断整次扫描
- **Agent 方案下**：模型不得绕过上述任何一条

### 架构铁律（给后续开发 / Agent 用）

1. UI 不允许直接访问文件系统
2. Rule / Agent 不允许直接执行删除
3. 所有删除必须先生成 CleanupPlan
4. CleanupPlan 必须经过 SafetyValidator
5. Scanner 可以宽泛，Cleaner 必须严格限制范围
6. 未识别数据默认视为不可删除

### UI 决策（当前实现 — 部分待迁移）

- 顶栏 + Tab：**清理 / 设置 / 关于**
- 清理页：单一「开始扫描」入口（空间发现 → 规则识别）；无模式切换
- 固定头部 + 结果区单滚动列表
- 三档 Tab 切换结果

### 规则源（当前实现）

```
config/
├── protected-paths.json
└── rules/
    ├── system.json
    ├── browsers.json
    ├── developer.json
    ├── agents.json
    └── apps.json
```

用户覆盖：`%APPDATA%/disk-clean/config/user-rules.json`

**待迁移**：规则转为可选经验库；扫描不依赖规则即可运行（目标方案）。

---

## 版本路线

### 目标路线（Agent）

见 [AGENT-ROADMAP.md](./AGENT-ROADMAP.md) 阶段 0–7。

### 历史 / 当前实现路线

| 版本 | 内容 | 状态 |
|------|------|------|
| V1 | 规则扫描 + Candidate + 风险 + Plan + Validator | ✅ 当前主干 |
| V2 | 空间分析 + 多盘符 + 大目录（独立 full 模式） | ✅ 当前主干 |
| V3 | 空间分析深度匹配规则 + 更多通用软件规则 | 暂缓，让位于 Agent 路线图 |
| V4（旧） | 可选 AI 分析目录 | **已取代** — 由 Agent 路线图阶段 4–5 承接（Agent 为整体判断者，非仅补充未知项） |

---

## 不做 / 暂缓

- **AI 自动删除**（模型仅建议，用户确认后本地执行）
- 杀毒、驱动拦截
- 托盘、启动项管理
- 外部 Codex / Cursor 作为运行时依赖
- OAuth 逆向代理、多 Key 自动轮换（第一版）
- 大文件全盘扫描（可纳入 Agent 渐进扫描，未单独立项）

---

## AI / Agent 职责（目标方案摘要）

| 可以做 | 不可以做 |
|--------|----------|
| 作为**主要判断者**综合扫描与本地证据，形成清理建议 | Shell、任意路径删除、绕过确认与 Validator |
| 请求只读深入分析（可优先大型/异常目录） | 自行解除 protectedPaths |
| 在脱敏摘要上推理 | 默认读取文件正文；JSON 不能替代其判断角色 |

即便接入模型：**Agent 决定建议什么；用户决定是否接受；本地程序决定能否安全执行。**

---

## 阶段 4.1：规则分层与 RuleDraft 草稿（2026-08-26，已完成）

| 决策 | 说明 |
|------|------|
| 四层架构 | 安全策略 / 通用识别 / 规则包 / 规则草稿；边界在代码中真实存在 |
| Agent 输出 | 只能生成 **RuleDraft**，不得直接设置 `deletable` / `defaultChecked` |
| 导入 JSON | 仅进入草稿区；须本机扫描预览 + 用户批准 |
| 通用 heuristics | 只补充 evidence，不授予清理权限 |
| Validator | **保持**阶段 6 前规则匹配模式；草稿批准后编译为保守 Recipe |
| 生效时机 | 批准后须重新扫描；不在旧快照中偷偷改变权限 |
| 未做 | 阶段 5 工具调用、阶段 6 会话授权、在线规则市场 |

详见 [RULES-v2.md](./RULES-v2.md)、[PHASE-4.1-REPORT.md](./PHASE-4.1-REPORT.md)。

### 阶段 4.1 UX 与判断流程（2026-08-26，已完成）

| 决策 | 说明 |
|------|------|
| 优先级 | **protected policy > 本地规则授权 > Agent 复核 > 空间 evidence** |
| Agent 角色 | 复核层：可降级（`uncertain`/`keep`），**不可扩大**清理权限 |
| 无 Key | 本地规则与扫描整理完整可用；不阻塞清理主流程 |
| 扫描中展示 | 空间项 `identifying`（正在识别），不作最终待判断/不建议计数 |
| 统一任务 | 扫描 → 本地整理 → Agent 复核（可选）→ 完成，同一进度区域 |
| 规则扩展 | 非常驻；扫描完成后次要入口；规则样本与清理勾选独立 |
| 启用规则 | 单一「启用规则」按钮；主进程 `confirmAndEnableRuleDraft` 原子操作 |
| 重新扫描 | 启用后不自动扫描；显式提示并复用上次盘符 |

---

## 阶段 4.2：统一清理模型与内置规则审计（2026-08-27，已完成）

| 决策 | 说明 |
|------|------|
| 统一任务 | 一次清理 = scanning → organizing → analyzing → planning → completed/failed/cancelled；无 Key / 有 Key 同一流程 |
| 结果分类 | 5 个稳定分类：建议清理 / 谨慎清理 / 高风险操作 / **空间占用** / 建议保留；进行中临时「正在识别」「正在分析」 |
| protected 语义 | **空间占用**，非「待判断 / 不建议」；限制**清理动作**，不限制 Agent 只读分析（5A/5B） |
| 大文件 ≠ 垃圾 | 空间占用类默认不可批量删除；体积 alone 不授予 deletable |
| app-logs | `reviewStatus: disabled`；过宽 `%LOCALAPPDATA%/**/Logs` 不再自动授权 |
| 浏览器规则 | 收窄 `globDirs`；`exclusions` 排除 Cookie/History/Extensions 等 |
| Temp 规则 | `maxAgeDays: 7`；跳过近期与占用中文件 |
| developer/agent 默认 | 全部 `defaultChecked: false`；缺少验证信息不得默认勾选 |
| 规则元数据 | `source`、`reviewStatus`、`requiresAppClosed`、`cleanupMethod` 等写入官方规则并在规则中心展示 |
| 首页规则闭环 | 预览 + 启用 + 重扫提示在清理页完成，不要求切换设置页 |
| 5B 契约 | `agent-candidate-prep.ts` 自动选取调查候选；本轮不实现多轮工具循环 |
| 未做 | 3.1 多 Provider、5B 编排、6 Validator 迁移、Shell、规则市场 |

详见 [PHASE-4.2-REPORT.md](./PHASE-4.2-REPORT.md)、[CLEANUP-TASK-MODEL.md](./CLEANUP-TASK-MODEL.md)、[BUILTIN-RULE-AUDIT.md](./BUILTIN-RULE-AUDIT.md)。

---

## 阶段 5A：只读调查基础设施（2026-08-27，已完成）

| 决策 | 说明 |
|------|------|
| 工具执行 | 仅主进程；白名单 `list_children` / `summarize_directory` / `sample_entry_names` |
| IPC 输入 | 仅 `sessionId`、`candidateRef`、受限 `relativePath` / `limit` / `depth` |
| 路径安全 | 候选根内 `realpath` 校验；拒绝 protected、symlink/junction、穿越 |
| 会话 | 复用 `ScanSession` + fingerprint；不新建平行会话存储 |
| 缓存 | 工具结果按 fingerprint 隔离；切换模型复用数据、不复用结论 |
| Agent 权限 | 调查不改变 `selectable` / `deletable`；清理授权仍由本地规则决定 |
| UI | 本轮仅最小状态标签；完整时间线留 5B |

详见 [INVESTIGATION-TOOLS.md](./INVESTIGATION-TOOLS.md)、[PHASE-5A-REPORT.md](./PHASE-5A-REPORT.md)。

---

## 阶段 5B：多轮调查编排与时间线 UI（2026-08-27，已完成）

| 决策 | 说明 |
|------|------|
| 入口 | 统一 `runAgentAnalysis()`；有 Key 时委托 `runInvestigationOrchestration()` |
| 候选引用 | canonical `candidateRef`；Prompt 缩减后工具白名单与 `build.refToId` 取交集 |
| 时间线 | 主进程 generation 权威；实时仅 `investigation_started` 绑定；最终 IPC 快照可独立绑定 |
| 任务态 | 首次分析与重试共用生命周期回调；停止 Agent 为 `completed + agentStatus=cancelled` |
| ref 注册表 | 新扫描清空；调查终态 `releaseCandidateRefMap`；32 条历史上限 |
| 未做 | UI 集中调整（延后） |

详见 [PHASE-5B-REPORT.md](./PHASE-5B-REPORT.md)、[INVESTIGATION-ORCHESTRATION.md](./INVESTIGATION-ORCHESTRATION.md)。

---

## 阶段 6：清理计划与执行闭环（2026-08-27 交付，2026-08-28 复审通过，已完成）

| 决策 | 说明 |
|------|------|
| 授权模型 | 主进程 `evaluateSessionCleanupAuthorization`；来源 `agent-session` / `local-rule` / `protected-policy` / `none` |
| IPC 契约 | Renderer 仅 `sessionId` + `fingerprint` + `candidateIds`；execute 仅 `confirmationId` |
| 两步确认 | `prepareCleanupConfirmation` → 预览 + 一次性 token；`executeConfirmedCleanup` 消费；tombstone / TTL / 容量上限 |
| Agent 授权 | `LocalExecutionSafety`（`agent-confirmable` 等）；`clean`/`confirm` + `snapshotComplete`；仅展示占用项保持 `agent-advice-only` |
| 规则兼容 | 启用规则仍走 `local-rule`；`cleanupMethod !== trash` → `ACTION_NOT_ALLOWED` |
| TOCTOU — 快照创建 | `validateAndCreateCleanupExecutionSnapshot` 单次 `lstat` 原子校验 + 身份捕获；目录测量后 anchor 复验 |
| TOCTOU — Cleaner 执行 | 每项 `trashItem` 前 `verifyCleanupExecutionSnapshot`；目录：递归测量后**第二次** `lstat` + identity anchor 复验 |
| 身份锚点 | 生产路径 `lstat(path, { bigint: true })`；`dev`/`ino`/`birthtimeNs`/`ctimeNs`/`mtimeNs`/`size` 存字符串；`captureMode`；非 bigint 环境失败关闭 |
| 快照隔离 | 单项校验失败 → `SNAPSHOT_STALE`，不中断同批其余项 |
| 复扫生命周期 | `planScanPreflight` + `commitScanPreflight`；全部确认通过后才放弃复扫上下文；失败 / 取消 / 重试 / 防并发闭环 |
| Cleaner | 仅 trash；不接受外部路径计划 |
| 复核 | 执行后 bump revision + 自动重扫 + `CleanupOutcomeManifest` 对比 |
| 未做 | 阶段 7；UI 集中调整；commit / push |

详见 [SESSION-CLEANUP-AUTHORIZATION.md](./SESSION-CLEANUP-AUTHORIZATION.md)、[PHASE-6-REPORT.md](./PHASE-6-REPORT.md)。

---

```powershell
git clone https://github.com/Joey-Fjh/disk-clean.git
cd disk-clean
npm install
npm start
```
