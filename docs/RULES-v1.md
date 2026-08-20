# 扫描规则说明

运行时由 `config/rules/` 目录加载，路径中的环境变量在扫描时展开。

用户可在 **设置 → 扫描规则** 中启用/禁用、导入自定义规则。

## 规则文件

| 文件 | 类别 | 条数 |
|------|------|------|
| `system.json` | 系统 | 8 |
| `browsers.json` | 浏览器 | 3 |
| `developer.json` | 开发工具 | 8 |
| `agents.json` | AI Agent | 3 |
| `apps.json` | 应用 / 聊天 | 4 |

合计 **26 条**内置规则。

## 三档说明

| 档位 | 说明 | 默认勾选 |
|------|------|----------|
| 低风险 (safe) | 明确缓存 / 临时文件 | 是 |
| 需确认 (recommended) | 可重新生成，但有成本 | 否 |
| 仅查看 (dangerous) | 只报告，不删除 | — |

## 数据性质（contentType）

规则除三档风险外，还标注数据性质，用于 UI 展示：

- `system-temp` — 系统临时文件
- `browser-cache` — 浏览器缓存
- `app-cache` / `app-logs` — 应用缓存与日志
- `download-leftover` — 下载残留
- `system-protected` — 系统受保护数据
- `developer` / `agent` / `chat` — 扩展分类

## 受保护路径（protectedPaths）

配置在 `config/protected-paths.json`：

```json
{
  "paths": [
    "%SystemDrive%\\",
    "%SystemRoot%\\System32",
    "%SystemRoot%\\WinSxS",
    "%ProgramFiles%",
    "%ProgramFiles(x86)%"
  ]
}
```

**语义：允许扫描统计，禁止 Cleaner 删除。**

路径使用环境变量，适配不同系统盘符（不限于 C:）。

## 盘符策略

- 系统路径通过 `%SystemDrive%`、`%SystemRoot%` 等解析
- 空间分析枚举本机所有存在的盘符
- 系统盘：Program Files、Windows、ProgramData、Users 等
- 其他盘：扫描根目录下一级文件夹

## 扫描模式

### 快速扫描（Quick Scan）

1. 读取已启用规则（内置 + 自定义，减去禁用项）
2. 逐条规则：展开环境变量 → 收集目标 → 递归算大小
3. 跳过 symlink；受保护路径可扫描但标记为不可删
4. 进度按规则条数推进

### 空间分析（Full Scan）

1. 枚举本机盘符
2. 系统盘扫主要系统目录 + Users 下用户文件夹
3. 其他盘扫根目录下一级
4. 不判断是否为垃圾，只展示占用
5. RuleMatcher 尝试为结果补充规则解释

## 清理链路

```
用户勾选 → CleanupPlan → SafetyValidator → Cleaner（回收站）→ CleanupResult
```

Validator 检查：规则是否启用、路径是否存在、realpath、protectedPaths、是否在规则允许范围内。

## 自定义规则 JSON 格式

```json
{
  "rules": [
    {
      "id": "my-rule",
      "name": "我的规则",
      "category": "safe",
      "contentType": "app-cache",
      "paths": ["%USERPROFILE%\\SomeFolder\\cache"],
      "defaultChecked": true,
      "reason": "为什么可以清理",
      "impact": "清理后的影响",
      "rebuildable": true
    }
  ]
}
```

也支持直接传规则数组 `[{ ... }]`。

### 允许字段

`id`, `name`, `category`, `contentType`, `paths`, `patterns`, `subdirs`, `globDirs`, `maxDepth`, `maxAgeDays`, `defaultChecked`, `description`, `reason`, `impact`, `rebuildable`, `cleanupStrategy`, `deletable`

### 禁止字段

`command`, `exec`, `script`, `shell`, `cmd`, `powershell`, `run`

## 已实现规则摘要

### 系统（system.json）

| ID | 名称 | 档位 |
|----|------|------|
| user-temp | 用户临时文件 | 低 |
| windows-temp | Windows Temp | 低 |
| thumbcache | 缩略图缓存 | 低 |
| error-reports | Windows 错误报告 | 低 |
| winsxs | Windows 组件存储 | 仅查看 |
| windows-old | Windows.old | 仅查看 |
| hiberfil | hiberfil.sys | 仅查看 |
| pagefile | pagefile.sys | 仅查看 |

### 浏览器（browsers.json）

Chrome / Edge / Firefox 缓存（支持多 Profile 的 `globDirs`）

### 开发工具（developer.json）

npm / pnpm / Yarn / pip / Gradle / Maven / VS Code / JetBrains

### AI Agent（agents.json）

Cursor / Claude 桌面版 / Codex 缓存

### 应用（apps.json）

微信 / QQ 缓存、下载目录旧安装包、常见应用日志

## 待实现

| 规则 ID | 名称 |
|---------|------|
| recycle-bin | 回收站 |
| large-user-files | 用户目录大文件排行 |
| installer-leftovers | 安装残留 |

## 注意事项

- 微信/QQ 只扫 Cache 类子目录，不碰聊天记录数据库
- Maven Repository 归「需确认」：删了要重新下载依赖
- `app-logs` 规则扫描范围较广，默认不勾选
