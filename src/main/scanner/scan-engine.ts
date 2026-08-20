import type { ScanMode, ScanProgress, ScanResult } from '../../shared/types'
import { runRuleScan } from './rule-scanner'
import { runDiskAnalysis, analyzeUserProfiles } from './disk-analyzer'
import { enrichCandidate } from './rule-matcher'

type ProgressCallback = (progress: ScanProgress) => void

export async function runScan(mode: ScanMode, onProgress?: ProgressCallback): Promise<ScanResult> {
  if (mode === 'quick') {
    const { items, errors } = await runRuleScan(onProgress)
    return {
      mode,
      items,
      errors,
      totalSize: items.reduce((sum, item) => sum + item.size, 0),
      scannedAt: new Date().toISOString()
    }
  }

  const { items: roots, errors } = await runDiskAnalysis(onProgress)
  const profiles = await analyzeUserProfiles(onProgress)

  const merged = [...roots, ...profiles]

  // RuleMatcher：尝试为分析结果补充规则解释
  const items = merged.map((item) =>
    enrichCandidate(item.path, item.size, {
      name: item.ruleName,
      contentType: item.contentType,
      category: item.category,
      deletable: item.deletable,
      reason: item.reason,
      impact: item.impact
    })
  )

  items.sort((a, b) => b.size - a.size)

  return {
    mode,
    items,
    errors,
    totalSize: items.reduce((sum, item) => sum + item.size, 0),
    scannedAt: new Date().toISOString()
  }
}
