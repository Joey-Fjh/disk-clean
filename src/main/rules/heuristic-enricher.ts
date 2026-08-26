import type { ScanItem } from '../../shared/types'
import type { DetectionHeuristic } from '../../shared/rule-layer-types'
import { loadDetectionHeuristics } from './rule-layer-loader'
import { normalizePath } from '../../shared/path-utils'

function matchesHeuristic(item: ScanItem, heuristic: DetectionHeuristic): boolean {
  const path = normalizePath(item.path)
  const segments = path.split('\\')

  if (heuristic.contentType && item.contentType !== heuristic.contentType) {
    // allow heuristic to suggest alternate evidence without changing deletable state
  }

  if (heuristic.subdirs?.length) {
    return heuristic.subdirs.some((sub) => segments.includes(sub.toLowerCase()))
  }

  if (heuristic.globDirs?.length) {
    return heuristic.globDirs.some((glob) => {
      const token = glob.replace(/\*\*\//g, '').replace(/\//g, '\\').toLowerCase()
      return token && path.includes(token)
    })
  }

  if (heuristic.patterns?.length) {
    const fileName = segments[segments.length - 1] ?? ''
    return heuristic.patterns.some((pattern) => fileName.includes(pattern.toLowerCase()))
  }

  return false
}

export function enrichItemsWithDetectionHeuristics(
  items: ScanItem[],
  heuristics = loadDetectionHeuristics()
): ScanItem[] {
  if (heuristics.length === 0) return items

  return items.map((item) => {
    const matched = heuristics.filter((heuristic) => matchesHeuristic(item, heuristic))
    if (matched.length === 0) return item

    const evidence = [...item.evidence]
    for (const heuristic of matched) {
      evidence.push({
        source: 'local-feature',
        summary: heuristic.reason ?? heuristic.name,
        ruleId: heuristic.id,
        ruleName: heuristic.name
      })
    }

    return {
      ...item,
      evidence,
      deletable: item.deletable,
      judgment: item.judgment,
      selection: item.selection
    }
  })
}
