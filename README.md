# Disk Clean

Windows 磁盘空间分析 + 安全清理桌面工具。

**核心原则：扫描尽量全面，删除必须保守。**

**当前状态（v0.1）**：Electron 应用可日常使用；支持快速规则扫描、磁盘空间分析、三档风险展示、清理计划校验后移入回收站。

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

## App 信息

| 项目 | 值 |
|------|-----|
| 名称 | Disk Clean |
| 版本 | v0.1.0 |
| 图标 | `build/icon.png` |
| 远程仓库 | https://github.com/Joey-Fjh/disk-clean.git |

## 功能概览

### 清理页

- **快速扫描**：按内置规则扫描已知可清理项（缓存、临时文件、日志等）
- **空间分析**：分析本机各磁盘目录占用（系统盘 + 其他盘符），不判断是否为垃圾
- 结果按三档 Tab：**低风险 / 需确认 / 仅查看**
- 每项展示数据类型、路径、大小、原因与影响说明
- 点击路径可在资源管理器中打开
- 用户勾选 + 二次确认 → 生成清理计划 → 安全校验 → 移入回收站

### 设置页

- 外观主题：浅色 / 深色 / 跟随系统
- 扫描规则：启用/禁用、分类筛选、导入 JSON、恢复默认
- 用户配置：`%APPDATA%/disk-clean/config/user-rules.json`

## 三档风险

| 档位 | 含义 | UI 策略 |
|------|------|---------|
| 低风险 | 明确缓存 / 临时文件 | 默认可勾选 |
| 需确认 | 可重新生成，但有使用成本 | 默认不勾选 |
| 仅查看 | 用户数据 / 系统数据 / 状态数据 | 只展示，不允许普通清理 |

## 架构

```
                    ScanEngine
                   /          \
          RuleScanner        DiskAnalyzer
                   \          /
                    Candidate (ScanItem)
                         ↓
                    RuleMatcher（规则只负责「解释」）
                         ↓
                    三档风险 UI
                         ↓
                   用户选择清理
                         ↓
                   CleanupPlan
                         ↓
                 SafetyValidator
                         ↓
                     Cleaner（回收站）
                         ↓
                  CleanupResult + audit.log
```

### 架构铁律

1. UI 不直接访问文件系统
2. Rule 不直接执行删除
3. 删除必须先生成 CleanupPlan
4. Plan 必须经过 SafetyValidator
5. Scanner 可宽，Cleaner 必须窄
6. 未识别数据默认不可删

## 项目结构

```
disk-clean/
├── config/
│   ├── protected-paths.json   # 受保护路径（可扫描、禁删除）
│   └── rules/                 # 内置规则（按类别分文件，共 26 条）
│       ├── system.json
│       ├── browsers.json
│       ├── developer.json
│       ├── agents.json
│       └── apps.json
├── build/icon.png
├── src/
│   ├── main/
│   │   ├── scanner/           # ScanEngine、RuleScanner、DiskAnalyzer、RuleMatcher
│   │   ├── cleanup/           # PlanBuilder、SafetyValidator、Cleaner
│   │   ├── rules/             # 规则加载与校验
│   │   └── index.ts           # IPC 入口
│   ├── preload/
│   ├── renderer/
│   └── shared/                # types、path-utils、system-paths
├── docs/
└── package.json
```

## 路径与盘符

- 系统路径通过 Windows 环境变量解析：`%SystemDrive%`、`%SystemRoot%`、`%ProgramFiles%` 等
- 空间分析自动枚举本机存在的盘符（不限于 C:）
- 系统盘扫 Program Files、Windows、Users 等；其他盘扫根目录下一级文件夹

## 技术栈

- Electron + TypeScript + electron-vite
- 扫描/清理/规则管理在主进程；UI 通过 preload IPC 通信
- 删除使用 `shell.trashItem()`，审计日志写入 `%APPDATA%/disk-clean/logs/audit.log`

## 版本路线

| 版本 | 内容 | 状态 |
|------|------|------|
| V1 | 规则扫描 + Candidate + 三档风险 + CleanupPlan + SafetyValidator | ✅ |
| V2 | 空间分析 + 大目录排行 + 多盘符 | ✅ 基础版 |
| V3 | 空间分析结果深度匹配规则 + 更多通用软件规则 | 进行中 |
| V4 | 可选 AI 分析未知目录（只建议，不自动删） | 未开始 |

## 已知局限

- 空间分析暂只到一级目录钻取（Users 下用户文件夹）
- Chrome/Edge 多 Profile、微信/QQ 多账号路径仍可能不全
- 快速扫描进度按规则条数计算，非按文件大小/耗时
- 回收站、大文件专项扫描等待实现

## 文档

- [产品决策](docs/DECISIONS.md)
- [扫描规则说明](docs/RULES-v1.md)
