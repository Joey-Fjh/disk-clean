# 产品决策

记录讨论结论，方便换电脑后继续。

最后更新：2026-08-20

## 定位

做 **磁盘空间分析 + 安全清理** 的 Windows 本地工具，不是通用 Agent，也不是杀毒软件。

> Disk Clean = 空间发现器 + 规则解释器 + 风险决策层 + 可审计清理执行器

参考对象：火绒 / 电脑管家的清理模块——但强调**透明**：每项展示原因、影响、风险，用户确认后才删除。

## 第一性原则

**扫描尽量全面，删除必须保守。**

```
发现占用 → 识别内容 → 判断风险 → 用户选择 → 安全清理 → 记录结果
```

不是 `Rule → fs.rm()`，而是：

```
Rule → Candidate → CleanupPlan → SafetyValidator → Cleaner
```

## 核心流程

```
扫描磁盘
   ↓
发现空间占用
   ↓
识别内容是什么（RuleMatcher 解释）
   ↓
判断风险和可恢复性
   ↓
用户选择
   ↓
安全清理（回收站）
   ↓
记录清理结果
```

## 双扫描引擎

```
ScanEngine
├── Quick Scan（快速扫描）
│   └── RuleScanner：已知规则，找明确垃圾
│
└── Full Scan（空间分析）
    └── DiskAnalyzer：不判断垃圾，只回答「空间被谁占了」
```

两者都产出 **Candidate**，规则只负责「解释」路径是什么、风险如何。

## 三档风险（统一命名）

| 档位 | 内部 ID | 含义 | UI 策略 |
|------|---------|------|---------|
| 低风险 | safe | 明确缓存 / 临时文件 | 默认可勾选 |
| 需确认 | recommended | 可重新生成，但有成本 | 默认不勾选 |
| 仅查看 | dangerous | 用户/系统/状态数据 | 只展示，不删除 |

## 数据性质分类（contentType）

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

## 安全底线

### protectedPaths（原 blacklist）

- 配置在 `config/protected-paths.json`
- 使用 `%SystemDrive%`、`%SystemRoot%` 等环境变量，不写死盘符
- **允许扫描统计，禁止 Cleaner 删除**
- 例：WinSxS 可显示「Windows 组件存储 · 12.8GB · 系统管理目录 · 不可直接删除」

### 其他

- 删除优先进回收站，不直接永久删除
- 不跟随 symlink / junction 递归（宁愿漏掉，不能越界）
- 自定义规则 JSON 只允许声明式字段，禁止 `command` / `exec` 等
- 权限拒绝：跳过并记录，不中断整次扫描

## 架构铁律（给后续开发 / Agent 用）

1. UI 不允许直接访问文件系统
2. Rule 不允许直接执行删除
3. 所有删除必须先生成 CleanupPlan
4. CleanupPlan 必须经过 SafetyValidator
5. Scanner 可以宽泛，Cleaner 必须严格限制范围
6. 未识别数据默认视为不可删除

## UI 决策

- 顶栏 + Tab：**清理 / 设置 / 关于**
- 清理页：快速扫描 + 空间分析 两个入口
- 固定头部 + 结果区单滚动列表
- 三档 Tab 切换结果，隐藏滚动条但保留滚轮

## 规则源

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

## 版本路线

| 版本 | 内容 |
|------|------|
| V1 | 规则扫描 + Candidate + 风险 + Plan + Validator | ✅ |
| V2 | 空间分析 + 多盘符 + 大目录 | ✅ 基础版 |
| V3 | 空间分析深度匹配规则 + 更多通用软件规则 | 待做 |
| V4 | 可选 AI 分析未知目录（只建议） | 不做 |

## 不做 / 暂缓

- AI 自动删除
- 杀毒、驱动拦截
- 托盘、启动项管理
- 大文件全盘扫描（V3 候选）

## AI 什么时候才需要

只有规则覆盖不了时，用于解释未知目录「可能是什么」。即便接入：

- AI 只做参谋
- 不能直接调删除
- 删除仍走 Plan + Validator + 用户确认

## 跨机器

```powershell
git clone https://github.com/Joey-Fjh/disk-clean.git
cd disk-clean
npm install
npm start
```
