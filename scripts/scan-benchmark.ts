import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { performance } from 'perf_hooks'
import { clearSessionMeasureCache, getSessionMeasureCacheStats, measurePathDetailed } from '../src/main/scanner/measure-size'

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

async function main(): Promise<void> {
  const root = join(tmpdir(), `disk-clean-bench-${Date.now()}`)
  const depth = Number(process.env.BENCH_DEPTH ?? 3)
  const breadth = Number(process.env.BENCH_BREADTH ?? 8)
  const files = createSyntheticTree(root, depth, breadth)

  clearSessionMeasureCache()
  const coldStart = performance.now()
  await measurePathDetailed(root, depth + 2, undefined, true)
  const coldMs = performance.now() - coldStart

  const warmStart = performance.now()
  await measurePathDetailed(root, depth + 2, undefined, true)
  const warmMs = performance.now() - warmStart
  const stats = getSessionMeasureCacheStats()

  console.log(
    JSON.stringify(
      {
        scenario: 'synthetic-tree',
        depth,
        breadth,
        filesCreated: files,
        coldMeasureMs: Math.round(coldMs),
        warmMeasureMs: Math.round(warmMs),
        cache: stats,
        machine: process.env.COMPUTERNAME ?? 'unknown',
        recordedAt: new Date().toISOString()
      },
      null,
      2
    )
  )

  rmSync(root, { recursive: true, force: true })
}

void main()
