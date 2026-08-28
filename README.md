# Disk Clean

Windows 磁盘空间分析 + 安全清理桌面工具。

**核心原则：扫描尽量全面，删除必须保守。**

---

## 当前版本 vs 目标方向

| | 说明 |
|---|------|
| **当前版本（v0.1，规则 + 单轮 Agent + 规则草稿 + 4.2 统一任务）** | Electron 应用：**统一清理任务模型**（扫描→整理→分析→完成）、**5+2 结果分类**、审计后的内置规则、Candidate 判断模型、**扫描完成后可选单轮 Agent 分析**（需自备 API Key）、规则四层与 RuleDraft、清理计划校验后移入回收站。 |
| **已确认的目标方向** | **Agent 驱动的统一扫描与清理流程**——空间发现 → Agent 调查与建议 → 用户确认 → 本地安全执行。详见 [Agent 产品方案](docs/PRODUCT-AGENT-DESIGN.md) 与 [开发路线图](docs/AGENT-ROADMAP.md)。 |

请勿将路线图中的目标能力理解为「当前已可用」。文档与代码不一致时，以 **代码与下方「当前功能」** 为准。

---

## 本地路径

```
D:\fjh\disk-clean
```

## 快速开始

```powershell
cd D:\fjh\disk-clean
npm install        # 首次
npm start          # 构建并打开 App
```

## 命令

| 命令 | 用途 |
|------|------|
| `npm start` | **日常使用** — 构建并打开 App |
| `npm run dev` | **开发调试** — 热更新 |
| `npm run pack` | **打包安装** — 生成 Windows 安装包（`release/`） |
| `npm run build` | 仅构建，不启动 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行测试 |

## App 信息

| 项目 | 值 |
|------|-----|
| 名称 | Disk Clean |
| 版本 | v0.1.0 |
| 图标 | `build/icon.png` |
| 远程仓库 | https://github.com/Joey-Fjh/disk-clean.git |

## 当前功能（规则驱动 v0.1）

以下功能 **已在当前代码中实现**：

### 清理页

- **统一扫描**（`combined`）：一次「开始扫描」依次完成 **空间发现**（`DiskAnalyzer`）与 **规则识别**（`RuleScanner`），合并为单一 `ScanResult` 与 `sessionId`
- 选择盘符：全部磁盘或指定盘符（无模式切换）
- **统一清理任务**（阶段 4.2）：扫描 → 整理空间占用 → 本地规则 / Agent 分析 → 完成；进度区单一主/副标题
- 结果按 **5+2 展示分类**：建议清理 / 谨慎清理 / 高风险操作 / **空间占用** / 建议保留（进行中：正在识别 / 正在分析）
- 相同路径合并为**单一 Candidate**，保留空间与规则证据；规则判断驱动 legacy 执行字段
- 「可清理逻辑大小估算」仅统计 `selection.selectable` 项，不含待判断的空间占用
- 每项展示数据类型、路径、大小、原因与影响说明；按规则分组可折叠展示
- 点击路径可在资源管理器中打开
- 用户勾选 + 二次确认 → **会话授权**（`prepareCleanup` / `executeConfirmedCleanup`）→ 安全校验 → 移入回收站 → 自动重扫复核

> 内部仍保留 `quick` / `full` 类型与遗留入口（供测试或兼容），用户界面不再暴露模式选择。

### 设置页

- 外观主题：浅色 / 深色 / 跟随系统
- **模型连接**（阶段 3 / **3.1 已完成**）：多份命名配置（OpenAI / DeepSeek / Custom），每份独立 URL、模型与加密 Key；选择当前启用配置；连接/能力测试 per Profile；详见 [PHASE-3.1-REPORT.md](docs/PHASE-3.1-REPORT.md)
- **单轮 Agent 分析**（阶段 4）：扫描完成后主进程脱敏摘要 → 模型建议 → 写回 Candidate；无 Key 时降级为纯本地发现
- **阶段 5B（已完成）**：多轮只读调查编排、自动工具调用、调查时间线 UI；详见 [PHASE-5B-REPORT.md](docs/PHASE-5B-REPORT.md)、[INVESTIGATION-ORCHESTRATION.md](docs/INVESTIGATION-ORCHESTRATION.md)
- **阶段 6（已完成）**：会话候选项授权、两步确认（`confirmationId`）、Agent 非规则项可执行、bigint TOCTOU 防护、清理后自动复扫复核；详见 [PHASE-6-REPORT.md](docs/PHASE-6-REPORT.md)、[SESSION-CLEANUP-AUTHORIZATION.md](docs/SESSION-CLEANUP-AUTHORIZATION.md)
- **阶段 4.1（已完成）**：规则四层 + 扩展规则闭环；**本地规则授权清理，Agent 仅复核/降级**；详见 [PHASE-4.1-REPORT.md](docs/PHASE-4.1-REPORT.md)
- **阶段 4.2（已完成）**：统一清理任务模型、内置规则审计、5+2 结果分类、首页规则内联预览/启用；详见 [PHASE-4.2-REPORT.md](docs/PHASE-4.2-REPORT.md)、[CLEANUP-TASK-MODEL.md](docs/CLEANUP-TASK-MODEL.md)
- 扫描规则：启用/禁用、分类筛选、导入 JSON、恢复默认
- 用户配置：`%APPDATA%/disk-clean/config/user-rules.json`
- 模型配置：`%APPDATA%/disk-clean/config/provider-config.json`（schema v2，多 Profile，Key 为密文）

- **阶段 5A（已完成）**：只读调查工具、路径安全、调查状态机与会话缓存；详见 [PHASE-5A-REPORT.md](docs/PHASE-5A-REPORT.md)、[INVESTIGATION-TOOLS.md](docs/INVESTIGATION-TOOLS.md)
- **阶段 5B（已完成）**：多轮编排与调查时间线；见上

### 尚未实现（阶段 7，见路线图）

- **阶段 7A（进行中）**：UI 与主流程集中调整 — 见 [UX-FLOW-v1.md](docs/UX-FLOW-v1.md)
- 用户经验库（7B）
- 扫描性能优化（7C）
- 可安装 MVP 发布（7D）

## 结果分类（当前 UI，阶段 4.2）

| 分类 ID | UI 文案 | 含义 | UI 策略 |
|---------|---------|------|---------|
| recommended-clean | 建议清理 | 已有可靠清理授权 | 默认可勾选 |
| caution-clean | 谨慎清理 | 可能可清理，需理解影响 | 默认不勾选 |
| high-risk-action | 高风险操作 | 须系统工具或单独确认 | 不可批量删除 |
| space-occupancy | 空间占用 | 大文件/目录或 protected 统计；**不代表垃圾** | 不可勾选 |
| recommended-keep | 建议保留 | 系统、配置或 Agent 判断应保留 | 不可勾选 |

进行中临时：**正在识别** / **正在分析**。内部 legacy `Category`（safe/recommended/dangerous）仍供 Validator 使用。

## 架构（当前实现）

```
                    ScanEngine（combined）
                           |
              1. 空间发现（DiskAnalyzer）
                           |
              2. 规则识别（RuleScanner）
                           |
              mergeScanCandidates（同路径合并证据）
                           |
                    5+2 展示分类 UI（由 cleanup-display-category 驱动）
                           ↓
                   用户选择清理
                           ↓
                   CleanupPlan
                           ↓
         SafetyValidator（会话候选项授权 + TOCTOU 快照）
                           ↓
                     Cleaner（回收站）
```

> `DiskAnalyzer` 扫描中产出 **正在识别（identifying）** 的 Candidate，本地规则整理后转为最终分类；未获规则授权的空间项不可勾选。`RuleScanner` 产出 legacy 规则候选项（`suggested` / `caution`），仍由 `SafetyValidator` 按规则授权。同路径时合并双方证据。Agent 可复核但不可扩大清理权限。

### 架构铁律

1. UI 不直接访问文件系统
2. Rule 不直接执行删除
3. 删除必须先生成 CleanupPlan
4. Plan 必须经过 SafetyValidator
5. Scanner 可宽，Cleaner 必须窄
6. 未识别数据默认不可删

目标方案在 Agent 介入后仍遵守上述执行铁律；详见 [PRODUCT-AGENT-DESIGN.md](docs/PRODUCT-AGENT-DESIGN.md)。

## 项目结构

```
disk-clean/
├── config/
│   ├── protected-paths.json   # 受保护路径（可扫描、禁删除）
│   └── rules/                 # 内置规则（按类别分文件）
├── build/icon.png
├── src/
│   ├── main/
│   │   ├── scanner/           # ScanEngine、RuleScanner、DiskAnalyzer、RuleMatcher
│   │   ├── cleanup/           # PlanBuilder、SafetyValidator、Cleaner
│   │   ├── rules/             # 规则加载与校验
│   │   └── index.ts           # IPC 入口
│   ├── preload/
│   ├── renderer/
│   └── shared/
├── docs/
└── package.json
```

## 路径与盘符

- 系统路径通过 Windows 环境变量解析：`%SystemDrive%`、`%SystemRoot%`、`%ProgramFiles%` 等
- 空间分析枚举本机存在的盘符（不限于 C:）
- 系统盘扫 Program Files、Windows、Users 等；其他盘扫根目录下一级文件夹

## 技术栈

- Electron + TypeScript + electron-vite
- 扫描/清理/规则管理在主进程；UI 通过 preload IPC 通信
- 删除使用 `shell.trashItem()`，审计日志写入 `%APPDATA%/disk-clean/logs/audit.log`

## 已知局限（当前版本）

- 「安全清理」与「空间分析」双模式 UI（已合并为统一扫描，阶段 1）
- 空间分析暂只到一级目录钻取（Users 下用户文件夹）
- Chrome/Edge 多 Profile、微信/QQ 多账号路径仍可能不全
- 扫描进度按规则条数计算，非按文件大小/耗时
- 无 Agent；清理判断依赖规则定义；`full` 模式下规则解释仅为可选补充

## 文档

| 文档 | 说明 |
|------|------|
| [Agent 产品方案](docs/PRODUCT-AGENT-DESIGN.md) | **目标方向**（设计基线，尚未全面实施） |
| [Agent 开发路线图](docs/AGENT-ROADMAP.md) | 分阶段实施计划（阶段 0 起） |
| [产品决策](docs/DECISIONS.md) | 已确认决策与分阶段实现记录 |
| [扫描规则说明](docs/RULES-v1.md) | **当前 V1 规则系统**实现说明（迁移期仍有效） |
| [规则体系 V2](docs/RULES-v2.md) | 四层架构 + 4.2 元数据与审计 |
| [统一清理任务模型](docs/CLEANUP-TASK-MODEL.md) | 任务阶段与 5B 输入契约 |
| [内置规则审计](docs/BUILTIN-RULE-AUDIT.md) | 27 条官方规则逐条审计表 |
| [阶段 4.2 报告](docs/PHASE-4.2-REPORT.md) | 4.2 交付与验收清单 |
| [阶段 5B 报告](docs/PHASE-5B-REPORT.md) | 多轮调查编排与时间线 UI |
| [调查编排](docs/INVESTIGATION-ORCHESTRATION.md) | 5B 主进程多轮循环与回合 Schema |
| [阶段 6 报告](docs/PHASE-6-REPORT.md) | 清理执行闭环与复审记录 |
| [会话清理授权](docs/SESSION-CLEANUP-AUTHORIZATION.md) | Validator 会话授权模型 |
