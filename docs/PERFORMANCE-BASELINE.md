# Performance Baseline (v0.1)

## Harness

```bash
npm run benchmark
```

环境变量：

- `BENCH_DEPTH`（默认 3）
- `BENCH_BREADTH`（默认 8）

输出 JSON 包含冷/热测量耗时与 session measure cache 命中率。

## 优化项（7C）

| 项 | 说明 |
|----|------|
| Session measure cache | 单次扫描内同路径+深度复用 `measurePathDetailed` 结果 |
| Cache 失效 | 每次 `runScan` 开始 `clearSessionMeasureCache()` |
| 安全 | 缓存仅用于扫描展示优化，Validator/Cleaner 仍实时读文件系统 |

## 示例记录（开发机，2026-08-31）

> 实际数值因机器而异，CI 不做毫秒级断言。

| 场景 | coldMeasureMs | warmMeasureMs | cache.hits |
|------|---------------|---------------|------------|
| depth=3 breadth=8 | 38 | 0 | 1 |

## 已知限制

- 跨扫描缓存未启用（需 TTL/版本/mtime 失效策略）
- 规则目标收集仍按规则独立 fast-glob
