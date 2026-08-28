import { applyAgentJudgmentToItem, normalizeCandidate } from '../../shared/candidate-model'
import { markCandidateAgentConfirmable } from '../../shared/execution-safety'
import type { AgentCandidateInsight, AgentVerdict } from '../../shared/agent-types'
import type { CandidateEvidence, ConfidenceLevel, ScanItem } from '../../shared/types'
import { isProtectedPath } from '../../shared/path-utils'
import type { ValidatedAgentRecommendation } from './agent-response'

export function verdictToJudgmentStatus(verdict: AgentVerdict) {
  if (verdict === 'clean') return 'suggested' as const
  if (verdict === 'confirm') return 'caution' as const
  if (verdict === 'keep') return 'keep' as const
  return 'uncertain' as const
}

export function mapAgentConfidence(confidence: ValidatedAgentRecommendation['confidence']): ConfidenceLevel {
  if (confidence === 'high') return 'high'
  if (confidence === 'medium') return 'medium'
  if (confidence === 'low') return 'low'
  return 'unknown'
}

export function applyAgentRecommendation(
  item: ScanItem,
  recommendation: ValidatedAgentRecommendation,
  protectedPath = false
): ScanItem {
  const agentInsight: AgentCandidateInsight = {
    likelyContent: recommendation.likelyContent,
    reason: recommendation.reason,
    impact: recommendation.impact
  }

  const agentEvidence: CandidateEvidence = {
    source: 'agent',
    summary: `${recommendation.likelyContent} — ${recommendation.reason}`
  }

  const merged = applyAgentJudgmentToItem(
    item,
    {
      verdict: recommendation.verdict,
      confidence: mapAgentConfidence(recommendation.confidence),
      basis: recommendation.basis
    },
    protectedPath
  )

  return normalizeCandidate({
    ...merged,
    agentInsight,
    evidence: [...merged.evidence, agentEvidence],
    discoverySources: merged.discoverySources.includes('agent')
      ? merged.discoverySources
      : [...merged.discoverySources, 'agent']
  })
}

export function applyAgentRecommendations(
  items: ScanItem[],
  recommendations: ValidatedAgentRecommendation[],
  refToId: Map<string, string>,
  protectedPaths: string[] = []
): { items: ScanItem[]; appliedCount: number } {
  const recommendationById = new Map<string, ValidatedAgentRecommendation>()
  for (const recommendation of recommendations) {
    const id = refToId.get(recommendation.candidateRef)
    if (!id) continue
    recommendationById.set(id, recommendation)
  }

  let appliedCount = 0
  const nextItems = items.map((item) => {
    const recommendation = recommendationById.get(item.id)
    if (!recommendation) return item
    appliedCount += 1
    const protectedPath = isProtectedPath(item.path, protectedPaths)
    const prepared = markCandidateAgentConfirmable(item)
    return applyAgentRecommendation(prepared, recommendation, protectedPath)
  })

  return { items: nextItems, appliedCount }
}

export function preserveLocalExecutionFacts(before: ScanItem, after: ScanItem): boolean {
  return (
    before.id === after.id &&
    before.path === after.path &&
    before.size === after.size &&
    before.snapshotComplete === after.snapshotComplete &&
    before.mtimeMs === after.mtimeMs &&
    before.entryKind === after.entryKind &&
    before.parentTarget === after.parentTarget &&
    before.ruleId === after.ruleId
  )
}

export function agentCannotExpandAnalyzerOnly(item: ScanItem): boolean {
  const normalized = normalizeCandidate(item)
  return !normalized.selection.selectable && !item.deletable
}
