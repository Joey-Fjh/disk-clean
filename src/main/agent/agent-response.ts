import { AGENT_LIMITS } from '../../shared/agent-limits'
import { AGENT_SCHEMA_VERSION } from '../../shared/agent-types'
import type {
  AgentConfidence,
  AgentModelResponse,
  AgentRecommendation,
  AgentVerdict
} from '../../shared/agent-types'

export interface ValidatedAgentRecommendation {
  candidateRef: string
  verdict: AgentVerdict
  likelyContent: string
  reason: string
  impact: string
  confidence: AgentConfidence
  basis: string[]
}

export interface ParseAgentResponseResult {
  summary: AgentModelResponse['summary']
  recommendations: ValidatedAgentRecommendation[]
  skippedInvalidCount: number
}

const VERDICTS = new Set<AgentVerdict>(['clean', 'confirm', 'keep', 'uncertain'])
const CONFIDENCE = new Set<AgentConfidence>(['high', 'medium', 'low'])

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fence ? fence[1].trim() : trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return truncate(trimmed, max)
}

function parseBasis(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > AGENT_LIMITS.MAX_BASIS_ITEMS) return null
  const basis: string[] = []
  for (const entry of value) {
    const parsed = parseString(entry, AGENT_LIMITS.MAX_BASIS_ITEM_LENGTH)
    if (!parsed) return null
    basis.push(parsed)
  }
  return basis
}

function parseRecommendation(value: unknown): ValidatedAgentRecommendation | null {
  if (!isRecord(value)) return null
  const candidateRef = parseString(value.candidateRef, 64)
  const verdict = value.verdict
  const likelyContent = parseString(value.likelyContent, AGENT_LIMITS.MAX_TEXT_FIELD_LENGTH)
  const reason = parseString(value.reason, AGENT_LIMITS.MAX_TEXT_FIELD_LENGTH)
  const impact = parseString(value.impact, AGENT_LIMITS.MAX_TEXT_FIELD_LENGTH)
  const confidence = value.confidence
  const basis = parseBasis(value.basis)
  if (!candidateRef || !VERDICTS.has(verdict as AgentVerdict)) return null
  if (!CONFIDENCE.has(confidence as AgentConfidence)) return null
  if (!likelyContent || !reason || !impact || !basis) return null
  return {
    candidateRef,
    verdict: verdict as AgentVerdict,
    likelyContent,
    reason,
    impact,
    confidence: confidence as AgentConfidence,
    basis
  }
}

export function parseAgentModelResponse(raw: string): ParseAgentResponseResult {
  const jsonText = stripMarkdownFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('RESPONSE_INVALID')
  }
  if (!isRecord(parsed)) throw new Error('RESPONSE_INVALID')
  if (parsed.schemaVersion !== AGENT_SCHEMA_VERSION) throw new Error('RESPONSE_INVALID')

  const summaryRecord = parsed.summary
  if (!isRecord(summaryRecord)) throw new Error('RESPONSE_INVALID')
  const headline = parseString(summaryRecord.headline, AGENT_LIMITS.MAX_SUMMARY_HEADLINE_LENGTH)
  const overview = parseString(summaryRecord.overview, AGENT_LIMITS.MAX_SUMMARY_OVERVIEW_LENGTH)
  if (!headline || !overview) throw new Error('RESPONSE_INVALID')

  if (!Array.isArray(parsed.recommendations)) throw new Error('RESPONSE_INVALID')
  if (parsed.recommendations.length > AGENT_LIMITS.MAX_RECOMMENDATIONS) {
    throw new Error('RESPONSE_INVALID')
  }

  const seenRefs = new Set<string>()
  const recommendations: ValidatedAgentRecommendation[] = []
  let skippedInvalidCount = 0

  for (const entry of parsed.recommendations) {
    const recommendation = parseRecommendation(entry)
    if (!recommendation) {
      skippedInvalidCount += 1
      continue
    }
    if (seenRefs.has(recommendation.candidateRef)) {
      skippedInvalidCount += 1
      continue
    }
    seenRefs.add(recommendation.candidateRef)
    recommendations.push(recommendation)
  }

  return {
    summary: { headline, overview },
    recommendations,
    skippedInvalidCount
  }
}

export function filterRecommendationsByRefs(
  recommendations: ValidatedAgentRecommendation[],
  validRefs: Set<string>
): { accepted: ValidatedAgentRecommendation[]; skippedInvalidCount: number } {
  const accepted: ValidatedAgentRecommendation[] = []
  let skippedInvalidCount = 0
  for (const recommendation of recommendations) {
    if (!validRefs.has(recommendation.candidateRef)) {
      skippedInvalidCount += 1
      continue
    }
    accepted.push(recommendation)
  }
  return { accepted, skippedInvalidCount }
}

export type { AgentRecommendation }
