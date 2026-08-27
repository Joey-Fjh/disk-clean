# Disk Clean

Windows 磁盘空间分析 + 安全清理桌面工具。

**核心原则：扫描尽量全面，删除必须保守。**

---

## 当前版本 vs 目标方向

| | 说明 |
|---|------|
| **当前版本（v0.1，规则 + 单轮 Agent + 规则草稿）** | Electron 应用：统一扫描、Candidate 判断模型、**扫描完成后可选单轮 Agent 分析建议**（需自备 API Key）、**规则四层架构与 RuleDraft 草稿审阅**、三档风险展示、清理计划校验后移入回收站。 |
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
- 扫描进度显示内部阶段：空间发现 → 规则识别
- 结果按三档 Tab：**建议清理 / 谨慎处理 / 待判断 / 不建议**
- 相同路径合并为**单一 Candidate**，保留空间与规则证据；规则判断驱动 legacy 执行字段
- 「可清理逻辑大小估算」仅统计 `selection.selectable` 项，不含待判断的空间占用
- 每项展示数据类型、路径、大小、原因与影响说明；按规则分组可折叠展示
- 点击路径可在资源管理器中打开
- 用户勾选 + 二次确认 → 生成清理计划 → 安全校验 → 移入回收站

> 内部仍保留 `quick` / `full` 类型与遗留入口（供测试或兼容），用户界面不再暴露模式选择。

### 设置页

- 外观主题：浅色 / 深色 / 跟随系统
- **模型连接**（阶段 3）：Provider 预设、Base URL、模型、API Key（加密）、连接/能力测试
- **单轮 Agent 分析**（阶段 4）：扫描完成后主进程脱敏摘要 → 模型建议 → 写回 Candidate；无 Key 时降级为纯本地发现
- **阶段 4.1（已完成）**：规则四层 + 扩展规则闭环；**本地规则授权清理，Agent 仅复核/降级**；扫描与 Agent 为同一任务阶段；详见 [PHASE-4.1-REPORT.md](docs/PHASE-4.1-REPORT.md)
- 扫描规则：启用/禁用、分类筛选、导入 JSON、恢复默认
- 用户配置：`%APPDATA%/disk-clean/config/user-rules.json`
- 模型配置：`%APPDATA%/disk-clean/config/provider-config.json`（Key 为密文）

- **阶段 5A（已完成）**：只读调查工具、路径安全、调查状态机与会话缓存；详见 [PHASE-5A-REPORT.md](docs/PHASE-5A-REPORT.md)、[INVESTIGATION-TOOLS.md](docs/INVESTIGATION-TOOLS.md)

### 尚未实现（目标方案，见路线图）

- 多轮模型编排与调查时间线 UI（阶段 5B）
- 会话候选项授权模型（无 JSON 规则项的可执行路径，阶段 6）
- JSON 定位为证据与经验层（非主要决策入口）
- 过程可视化完整闭环（扫描 → Agent 调查 → 建议 → 确认 → 执行 → 重新扫描）

## 三档风险（当前 UI）

| 档位 | UI 文案 | 含义 | UI 策略 |
|------|---------|------|---------|
| safe | 建议清理 | 明确缓存 / 临时文件 | 默认可勾选 |
| recommended | 谨慎处理 | 可重新生成，但有使用成本 | 默认不勾选 |
| dangerous | 待判断 / 不建议 | 空间发现项等待判断；不建议清理项 | 不可勾选（待判断 / 建议保留 / 无法确定） |

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
                    三档风险 UI（由 judgment 驱动）
                           ↓
                   用户选择清理
                           ↓
                   CleanupPlan
                           ↓
         SafetyValidator（当前：须匹配已启用规则）
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
| [产品决策](docs/DECISIONS.md) | 已确认决策 + 当前实现（待迁移） |
| [扫描规则说明](docs/RULES-v1.md) | **当前 V1 规则系统**实现说明（迁移期仍有效） |
