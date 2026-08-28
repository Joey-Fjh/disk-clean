import { normalizeCandidate } from '../shared/candidate-model'
import type { ScanItem } from '../shared/types'

/** 用于增量 DOM patch：判断候选项展示内容是否变化。 */
export function computeScanItemRenderRevision(item: ScanItem): string {
  const normalized = normalizeCandidate(item)
  return JSON.stringify({
    judgmentStatus: normalized.judgment.status,
    judgmentSource: normalized.judgment.source,
    judgmentConfidence: normalized.judgment.confidence,
    judgmentBasis: normalized.judgment.basis,
    judgmentOrigin: normalized.judgment.judgmentOrigin,
    selectable: normalized.selection.selectable,
    notSelectableReason: normalized.selection.notSelectableReason,
    reason: item.reason,
    impact: item.impact,
    agentReason: item.agentInsight?.reason,
    agentLikely: item.agentInsight?.likelyContent,
    agentImpact: item.agentInsight?.impact,
    deletable: item.deletable,
    requiresAppClosed: item.requiresAppClosed,
    size: item.size
  })
}
