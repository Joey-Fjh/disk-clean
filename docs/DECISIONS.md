# 产品决策

记录讨论结论，方便换电脑后继续。

最后更新：2026-08-24

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
| 执行授权（目标） | 无 JSON 规则的 Agent 候选项在用户确认后**可**进入 Plan；授权依据为会话候选项 + 确认 + 本地安全策略（见 PRODUCT §5）；**当前 Validator 仍依赖规则匹配，待阶段 6 迁移** |
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

**待迁移**：Agent 成为主要判断者；规则/JSON 降为证据层；Validator 改为会话候选项授权（阶段 6）。

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

## 跨机器

```powershell
git clone https://github.com/Joey-Fjh/disk-clean.git
cd disk-clean
npm install
npm start
```
