import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { performance } from 'perf_hooks'
import {
  clearSessionMeasureCache,
  getSessionMeasureCacheStats,
  measurePathDetailed
} from '../src/main/scanner/measure-size'

interface BenchResult {
  scenario: string
  filesCreated?: number
  coldMeasureMs: number
  warmMeasureMs: number
  cache: ReturnType<typeof getSessionMeasureCacheStats>
  cancelled?: boolean
  note?: string
}

function createSyntheticTree(root: string, depth: number, breadth: number): number {
  let count = 0
  function walk(current: string, level: number): void {
    mkdirSync(current, { recursive: true })
    for (let index = 0; index < breadth; index += 1) {
      const filePath = join(current, `file-${level}-${index}.txt`)
      writeFileSync(filePath, 'x'.repeat(128))
      count += 1
      if (level < depth) {
        walk(join(current, `dir-${level}-${index}`), level + 1)
      }
    }
  }
  walk(root, 1)
  return count
}

function createFlatFiles(root: string, count: number): number {
  mkdirSync(root, { recursive: true })
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(root, `flat-${index}.txt`), 'x')
  }
  return count
}

function createOverlappingPaths(root: string): { files: number; overlapPath: string } {
  const outer = join(root, 'outer')
  const inner = join(outer, 'inner')
  mkdirSync(inner, { recursive: true })
  writeFileSync(join(outer, 'a.txt'), 'outer')
  writeFileSync(join(inner, 'b.txt'), 'inner')
  return { files: 2, overlapPath: outer }
}

async function runColdWarm(
  scenario: string,
  target: string,
  maxDepth: number,
  filesCreated?: number
): Promise<BenchResult> {
  clearSessionMeasureCache()
  const coldStart = performance.now()
  await measurePathDetailed(target, maxDepth, undefined, true)
  const coldMs = performance.now() - coldStart

  const warmStart = performance.now()
  await measurePathDetailed(target, maxDepth, undefined, true)
  const warmMs = performance.now() - warmStart

  return {
    scenario,
    filesCreated,
    coldMeasureMs: Math.round(coldMs),
    warmMeasureMs: Math.round(warmMs),
    cache: getSessionMeasureCacheStats()
  }
}

async function main(): Promise<void> {
  const stamp = Date.now()
  const base = join(tmpdir(), `disk-clean-bench-${stamp}`)
  const results: BenchResult[] = []

  try {
    const quickRoot = join(base, 'quick')
    const quickFiles = createSyntheticTree(quickRoot, 3, 8)
    results.push(await runColdWarm('default-quick', quickRoot, 5, quickFiles))

    const largeRoot = join(base, 'large-10k')
    const largeFiles = createFlatFiles(largeRoot, 10_000)
    results.push(await runColdWarm('flat-10000-files', largeRoot, 1, largeFiles))

    const overlapRoot = join(base, 'overlap')
    const overlap = createOverlappingPaths(overlapRoot)
    clearSessionMeasureCache()
    const overlapColdStart = performance.now()
    await measurePathDetailed(overlap.overlapPath, 8, undefined, true)
    await measurePathDetailed(join(overlap.overlapPath, 'inner'), 4, undefined, true)
    const overlapColdMs = performance.now() - overlapColdStart
    clearSessionMeasureCache()
    const overlapWarmStart = performance.now()
    await measurePathDetailed(overlap.overlapPath, 8, undefined, true)
    await measurePathDetailed(join(overlap.overlapPath, 'inner'), 4, undefined, true)
    const overlapWarmMs = performance.now() - overlapWarmStart
    results.push({
      scenario: 'overlapping-paths',
      filesCreated: overlap.files,
      coldMeasureMs: Math.round(overlapColdMs),
      warmMeasureMs: Math.round(overlapWarmMs),
      cache: getSessionMeasureCacheStats(),
      note: 'parent/child measured with different maxDepth'
    })

    const cancelRoot = join(base, 'cancel')
    createFlatFiles(cancelRoot, 200)
    clearSessionMeasureCache()
    const controller = new AbortController()
    const cancelStart = performance.now()
    const cancelPromise = measurePathDetailed(cancelRoot, 1, controller.signal, true)
    controller.abort()
    await cancelPromise
    const cancelMs = performance.now() - cancelStart
    results.push({
      scenario: 'mid-cancel',
      filesCreated: 200,
      coldMeasureMs: Math.round(cancelMs),
      warmMeasureMs: 0,
      cache: getSessionMeasureCacheStats(),
      cancelled: true,
      note: 'aborted measurement should not populate cache'
    })

    console.log(
      JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          machine: process.env.COMPUTERNAME ?? 'unknown',
          disclaimer: '示例数据来自本机一次性运行，不代表固定 SLA',
          results
        },
        null,
        2
      )
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

void main()
