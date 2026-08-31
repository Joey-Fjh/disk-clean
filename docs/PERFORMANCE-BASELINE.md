# Performance Baseline (v0.1)

## Harness

```bash
npm run benchmark
```

`tsx` 已列入 `devDependencies`，脚本直接调用本地 `tsx`，不依赖 `npx` 临时下载。

## 场景

| 场景 | 说明 |
|------|------|
| `default-quick` | 默认快速树（depth=3, breadth=8） |
| `flat-10000-files` | 约 10,000 个扁平文件 |
| `overlapping-paths` | 父子目录重叠路径，不同 maxDepth |
| `mid-cancel` | 中途 AbortSignal 取消 |

输出 JSON 包含冷/热测量耗时、文件数与 session measure cache 命中率。

> **注意**：下方示例为本机一次性实测，**不代表固定 SLA**；请以本机 `npm run benchmark` 输出为准。

## 优化项（7C + RC 收口）

| 项 | 说明 |
|----|------|
| Session measure cache | 单次扫描内同路径+深度复用 `measurePathDetailed` 结果 |
| Cache 写入边界 | 仅完整（`incomplete=false`）且未取消/未超时的结果入缓存 |
| Cache 失效 | 每次 `runScan` 开始 `clearSessionMeasureCache()` |
| 安全 | 缓存仅用于扫描展示优化，Validator/Cleaner 仍实时读文件系统 |

## 示例记录（开发机，2026-08-31）

> 实际数值因机器而异，CI 不做毫秒级断言。

| 场景 | coldMeasureMs | warmMeasureMs | cache.hits |
|------|---------------|---------------|------------|
| default-quick | （本机运行） | （本机运行） | 1 |
| flat-10000-files | （本机运行） | （本机运行） | 1 |

## 已知限制

- 跨扫描缓存未启用（需 TTL/版本/mtime 失效策略）
- 规则目标收集仍按规则独立 fast-glob
