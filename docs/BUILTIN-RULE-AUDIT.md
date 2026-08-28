# 内置规则逐条审计（阶段 4.2）

> 审计对象：`config/rule-packs/official/*.json` 与同步的 `config/rules/*.json`（共 **27** 条）。  
> 审计日期：2026-08-27。处置：**保留** / **修正** / **降级** / **禁用**。

## 审计原则摘要

1. 不凭规则名称推断安全性；以路径范围与元数据为准  
2. 禁止过宽 `**/Cache`、`**/Logs` 在任意位置直接授权删除  
3. Temp 须考虑文件年龄（`maxAgeDays`）  
4. 浏览器规则须排除 Cookie、登录、历史、扩展等  
5. Agent 工具规则须排除 auth、session、SQLite、settings、plugins  
6. 开发工具须区分可重建缓存 vs 工具自管存储 vs 项目状态  
7. 微信/QQ/下载/媒体为用户内容，默认不可自动删除  
8. WinSxS、pagefile、hiberfil、Windows.old 使用 system-managed 语义  
9. 无可靠证据的规则不得提供自动清理授权  

---

## system（8）

| ID | 类别 | 路径范围 | 真实存在 | 适用版本 | 仅缓存 | 用户内容风险 | 配置/会话风险 | 可重建 | 需关应用 | 默认勾选 | 推荐动作 | 处置 |
|----|------|----------|----------|----------|--------|--------------|---------------|--------|----------|----------|----------|------|
| user-temp | 系统临时 | `%TEMP%`, `%LOCALAPPDATA%\Temp`；`maxAgeDays: 7` | Windows 标准目录 | Win10/11 | 是 | 低 | 低 | 是 | 否 | 是 | trash（跳过 7 天内文件） | **修正** |
| windows-temp | 系统临时 | `%SystemRoot%\Temp`；`maxAgeDays: 7` | 是 | Win10/11 | 是 | 低 | 低 | 是 | 否 | 是 | trash | **修正** |
| thumbcache | 系统缓存 | `%LOCALAPPDATA%\Microsoft\Windows\Explorer` + `thumbcache_*.db` | 是 | Win10/11 | 是 | 低 | 低 | 是 | 否 | 是 | trash | **保留** |
| error-reports | 应用日志 | `%LOCALAPPDATA%\Microsoft\Windows\WER` | 是 | Win10/11 | 是（崩溃报告） | 低 | 低 | 是 | 否 | 是 | trash | **保留** |
| winsxs | 系统受保护 | `%SystemRoot%\WinSxS` | 是 | Win10/11 | 否 | 高 | 高 | 否 | — | 否 | system-managed（DISM） | **保留** |
| windows-old | 安装残留 | `%SystemDrive%\Windows.old` | 条件存在 | Win10/11 | 否 | 高 | 高 | 否 | — | 否 | system-managed | **保留** |
| hiberfil | 系统受保护 | `%SystemDrive%\hiberfil.sys` | 是 | Win10/11 | 否 | 高 | 高 | 否 | — | 否 | system-managed | **保留** |
| pagefile | 系统受保护 | `%SystemDrive%\pagefile.sys` | 是 | Win10/11 | 否 | 高 | 高 | 否 | — | 否 | system-managed | **保留** |

---

## browsers（3）

| ID | 类别 | 路径范围 | 真实存在 | 适用版本 | 仅缓存 | 用户内容风险 | 配置/会话风险 | 可重建 | 需关应用 | 默认勾选 | 推荐动作 | 处置 |
|----|------|----------|----------|----------|--------|--------------|---------------|--------|----------|----------|----------|------|
| chrome-cache | 浏览器缓存 | `%LOCALAPPDATA%\Google\Chrome\User Data` + 明确 `globDirs`（Default\Cache 等）；`exclusions` 含 Cookies/History/Extensions | 是 | Chrome 当前结构 | 是 | 低 | 低（已排除登录数据） | 是 | 是 | 是 | trash | **修正** |
| edge-cache | 浏览器缓存 | `%LOCALAPPDATA%\Microsoft\Edge\User Data` + 同上收窄 glob | 是 | Edge 当前结构 | 是 | 低 | 低 | 是 | 是 | 是 | trash | **修正** |
| firefox-cache | 浏览器缓存 | `%LOCALAPPDATA%\Mozilla\Firefox\Profiles` + `cache2`, `startupCache` | 是 | Firefox 当前结构 | 是 | 低 | 低 | 是 | 是 | 是 | trash | **保留** |

**4.2 修正要点**：移除宽泛 `**/Cache`；Chrome/Edge 增加 `exclusions` 列表。

---

## apps（5）

| ID | 类别 | 路径范围 | 真实存在 | 适用版本 | 仅缓存 | 用户内容风险 | 配置/会话风险 | 可重建 | 需关应用 | 默认勾选 | 推荐动作 | 处置 |
|----|------|----------|----------|----------|--------|--------------|---------------|--------|----------|----------|----------|------|
| wechat-cache | 聊天缓存 | `%USERPROFILE%\Documents\WeChat Files` + `**/FileStorage/Cache` | 是 | 微信 PC 版 | 是 | 低 | 低 | 是 | 否 | 否 | review-before-delete | **保留** |
| wechat-media | 用户数据 | 同上 + `Image`/`Video`；`deletable: false` | 是 | 微信 PC 版 | 否 | **高** | 中 | 否 | — | 否 | manual / 空间占用 | **保留** |
| qq-preview-cache | 用户数据 | `%USERPROFILE%\Documents\Tencent Files` + Image/Video/FileRecv；`deletable: false` | 是 | QQ PC 版 | 否 | **高** | 中 | 否 | — | 否 | manual / 空间占用 | **保留** |
| downloads-installers | 下载残留 | `%USERPROFILE%\Downloads` + `*.exe/msi/iso`；`maxAgeDays: 30` | 是 | 通用 | 否 | 中 | 低 | 否 | 否 | 否 | review-before-delete | **保留** |
| app-logs | 应用日志 | `%LOCALAPPDATA%`/`%APPDATA%` + `**/Logs`；**过宽** | 部分 | 不确定 | 否 | **高** | **高** | 部分 | 否 | 否 | 无自动授权 | **禁用** |

**4.2 处置**：`app-logs` 设 `reviewStatus: disabled`，从活动规则集排除。

---

## developer（8）

| ID | 类别 | 路径范围 | 真实存在 | 适用版本 | 仅缓存 | 用户内容风险 | 配置/会话风险 | 可重建 | 需关应用 | 默认勾选 | 推荐动作 | 处置 |
|----|------|----------|----------|----------|--------|--------------|---------------|--------|----------|----------|----------|------|
| npm-cache | 开发缓存 | `%LOCALAPPDATA%\npm-cache`, `%APPDATA%\npm-cache` | 是 | npm 官方 | 是 | 低 | 低 | 是 | 否 | **否** | trash | **降级** |
| pnpm-store | 工具自管 | `%LOCALAPPDATA%\pnpm\store`, `cache`；`nativeManaged`, `deletable: false` | 是 | pnpm 官方 | 是 | 低 | 低 | 是 | 否 | 否 | system-managed（pnpm store prune） | **保留** |
| yarn-cache | 开发缓存 | `%LOCALAPPDATA%\Yarn\Cache`, `Berry\cache` | 是 | Yarn | 是 | 低 | 低 | 是 | 否 | **否** | trash | **降级** |
| pip-cache | 开发缓存 | `%LOCALAPPDATA%\pip\Cache` | 是 | pip | 是 | 低 | 低 | 是 | 否 | **否** | trash | **降级** |
| gradle-caches | 开发缓存 | `%USERPROFILE%\.gradle\caches` | 是 | Gradle | 是 | 低 | 低 | 是 | 否 | **否** | trash | **降级** |
| maven-repository | 依赖仓库 | `%USERPROFILE%\.m2\repository` | 是 | Maven | 部分 | 低 | 低 | 是 | 否 | **否** | review-before-delete | **降级** |
| vscode-cache | 编辑器缓存 | `%APPDATA%\Code` + Cache/CachedData/logs 等 | 是 | VS Code | 是 | 低 | 低（不含 User 配置） | 是 | 是 | **否** | trash | **降级** |
| jetbrains-caches | IDE 缓存 | `%LOCALAPPDATA%\JetBrains` + caches/logs | 是 | JetBrains | 是 | 低 | 中（不含项目配置） | 是 | 是 | **否** | trash | **降级** |

**4.2 处置**：developer 类全部 `defaultChecked: false`；`reviewStatus: conservative`（pnpm 为 verified + nativeManaged）。

---

## agents（3）

| ID | 类别 | 路径范围 | 真实存在 | 适用版本 | 仅缓存 | 用户内容风险 | 配置/会话风险 | 可重建 | 需关应用 | 默认勾选 | 推荐动作 | 处置 |
|----|------|----------|----------|----------|--------|--------------|---------------|--------|----------|----------|----------|------|
| cursor-cache | Agent 工具 | `%APPDATA%\Cursor` + Cache/logs 等；`exclusions` 含 User/Local Storage/Cookies | 是 | Cursor 当前 | 是 | 低 | **高若越界** | 是 | 是 | **否** | trash | **降级** |
| claude-desktop-cache | Agent 工具 | `%APPDATA%\Claude` + Cache/logs；排除 Local Storage/Cookies | 是 | Claude Desktop | 是 | 低 | **高若越界** | 是 | 是 | **否** | trash | **降级** |
| codex-cache | Agent 工具 | `%LOCALAPPDATA%\codex`, `%APPDATA%\Codex` + Cache/logs | 是 | Codex 客户端 | 是 | 低 | **高若越界** | 是 | 是 | **否** | trash | **降级** |

**4.2 处置**：全部 `defaultChecked: false`；`notes` 明确不触及 auth、conversation、SQLite、settings、plugins。

---

## 汇总

| 处置 | 数量 | 规则 ID |
|------|------|---------|
| **保留** | 14 | thumbcache, error-reports, winsxs, windows-old, hiberfil, pagefile, firefox-cache, wechat-cache, wechat-media, qq-preview-cache, downloads-installers, pnpm-store |
| **修正** | 4 | user-temp, windows-temp, chrome-cache, edge-cache |
| **降级** | 10 | npm-cache, yarn-cache, pip-cache, gradle-caches, maven-repository, vscode-cache, jetbrains-caches, cursor-cache, claude-desktop-cache, codex-cache |
| **禁用** | 1 | app-logs |

> 「降级」指保留规则条目与可选授权，但降低默认勾选与置信度（`defaultChecked: false`、`reviewStatus: conservative`），用户须主动启用并理解影响。

---

## 元数据字段（4.2 新增）

内置规则可携带：`source`、`sourceUrl`、`testedPlatforms`、`testedVersions`、`lastVerifiedAt`、`requiresAppClosed`、`cleanupMethod`、`reviewStatus`、`confidence`、`exclusions`、`notes`。

- `reviewStatus: verified` — 路径与行为经本地或公开资料验证  
- `reviewStatus: conservative` — 可用但默认不勾选  
- `reviewStatus: disabled` — 不进入活动规则集  

加载约束：`getLayeredActiveRules()` 跳过 `disabled`；非法规则隔离，不导致整次扫描失败。

---

## 相关文档

- [RULES-v2.md](./RULES-v2.md)
- [PHASE-4.2-REPORT.md](./PHASE-4.2-REPORT.md)
- [DECISIONS.md](./DECISIONS.md) — 阶段 4.2 决策
