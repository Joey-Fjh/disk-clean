import { RULE_DRAFT_SCHEMA_VERSION } from '../../shared/rule-layer-types'
import type { RuleDraftV1 } from '../../shared/rule-layer-types'
import { validateRuleDraftInput } from './rule-draft-validator'

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fence ? fence[1].trim() : trimmed
}

export function parseRuleDraftModelResponse(raw: string): RuleDraftV1 {
  const jsonText = stripMarkdownFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('RESPONSE_INVALID')
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('RESPONSE_INVALID')
  const record = parsed as Record<string, unknown>
  if (record.schemaVersion !== RULE_DRAFT_SCHEMA_VERSION) throw new Error('RESPONSE_INVALID')

  return validateRuleDraftInput({
    ...record,
    source: 'agent-generated',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
  })
}
