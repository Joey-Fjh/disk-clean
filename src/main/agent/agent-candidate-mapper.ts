import { normalizeCandidate } from '../../shared/candidate-model'
import type { AgentCandidateInsight, AgentVerdict } from '../../shared/agent-types'
import type {
  CandidateEvidence,
  CandidateJudgment,
  ConfidenceLevel,
  JudgmentStatus,
  ScanItem
} from '../../shared/types'
import type { ValidatedAgentRecommendation } from './agent-response'

function isRuleBacked(item: ScanItem): boolean {
  return item.discoverySources?.includes('rule') ?? item.source === 'rule'
}

function isSpaceOnly(item: ScanItem): boolean {
  return item.discoverySources.includes('space-scan') && !isRuleBacked(item)
}

export function verdictToJudgmentStatus(verdict: AgentVerdict): JudgmentStatus {
  switch (verdict) {
    case 'clean':
      return 'suggested'
    case 'confirm':
      return 'caution'
    case 'keep':
      return 'keep'
    case 'uncertain':
      return 'uncertain'
    default:
      return 'uncertain'
  }
}

export function mapAgentConfidence(confidence: ValidatedAgentRecommendation['confidence']): ConfidenceLevel {
  if (confidence === 'high') return 'high'
  if (confidence === 'medium') return 'medium'
  if (confidence === 'low') return 'low'
  return 'unknown'
}

export function applyAgentRecommendation(
  item: ScanItem,
  recommendation: ValidatedAgentRecommendation
): ScanItem {
  const status = verdictToJudgmentStatus(recommendation.verdict)
  const judgment: CandidateJudgment = {
    status,
    source: 'agent',
    confidence: mapAgentConfidence(recommendation.confidence),
    basis: recommendation.basis
  }

  const agentEvidence: CandidateEvidence = {
    source: 'agent',
    summary: `${recommendation.likelyContent} — ${recommendation.reason}`
  }

  const agentInsight: AgentCandidateInsight = {
    likelyContent: recommendation.likelyContent,
    reason: recommendation.reason,
    impact: recommendation.impact
  }

  const preservedDeletable = isSpaceOnly(item) ? false : item.deletable

  return normalizeCandidate({
    ...item,
    path: item.path,
    size: item.size,
    snapshotComplete: item.snapshotComplete,
    mtimeMs: item.mtimeMs,
    entryKind: item.entryKind,
    parentTarget: item.parentTarget,
    ruleId: item.ruleId,
    id: item.id,
    deletable: preservedDeletable,
    judgment,
    agentInsight,
    evidence: [...item.evidence, agentEvidence],
    discoverySources: item.discoverySources.includes('agent')
      ? item.discoverySources
      : [...item.discoverySources, 'agent']
  })
}

export function applyAgentRecommendations(
  items: ScanItem[],
  recommendations: ValidatedAgentRecommendation[],
  refToId: Map<string, string>
): { items: ScanItem[]; appliedCount: number } {
  const byId = new Map(items.map((item) => [item.id, item]))
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
    return applyAgentRecommendation(item, recommendation)
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
  if (!isSpaceOnly(item)) return true
  const normalized = normalizeCandidate(item)
  return !normalized.selection.selectable && !item.deletable
}
