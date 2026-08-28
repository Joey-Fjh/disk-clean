import { AGENT_LIMITS } from '../../../shared/agent-limits'
import { AGENT_SCHEMA_VERSION } from '../../../shared/agent-types'
import { INVESTIGATION_LIMITS, isInvestigationToolName } from '../../../shared/investigation-limits'
import type { InvestigationFinalTurn, InvestigationInvestigateTurn, InvestigationTurn } from '../../../shared/investigation-turn-types'
import { INVESTIGATION_TURN_SCHEMA_VERSION } from '../../../shared/investigation-turn-types'
import { parseAgentModelResponse, type ParseAgentResponseResult } from '../agent-response'

const FORBIDDEN_KEYS = new Set([
  'sessionId',
  'candidateId',
  'targetPath',
  'absolutePath',
  'path',
  'drive',
  'filePath'
])

const ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]|^\\\\/
const PARENT_SEGMENT_PATTERN = /(^|[\\/])\.\.([\\/]|$)/

export type ParsedModelTurn =
  | { kind: 'investigate'; turn: InvestigationInvestigateTurn }
  | { kind: 'final'; turn: InvestigationFinalTurn; parsed: ParseAgentResponseResult }
  | { kind: 'legacy-final'; parsed: ParseAgentResponseResult }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasForbiddenKeys(record: Record<string, unknown>, depth = 0): boolean {
  if (depth > 4) return true
  for (const [key, value] of Object.entries(record)) {
    if (FORBIDDEN_KEYS.has(key)) return true
    if (typeof value === 'string') {
      if (ABSOLUTE_PATH_PATTERN.test(value.trim())) return true
      if (PARENT_SEGMENT_PATTERN.test(value)) return true
    }
    if (isRecord(value) && hasForbiddenKeys(value, depth + 1)) return true
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          if (ABSOLUTE_PATH_PATTERN.test(entry.trim())) return true
          if (PARENT_SEGMENT_PATTERN.test(entry)) return true
        }
        if (isRecord(entry) && hasForbiddenKeys(entry, depth + 1)) return true
      }
    }
  }
  return false
}

function parsePurpose(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > AGENT_LIMITS.MAX_TEXT_FIELD_LENGTH) return null
  return trimmed
}

function parseRelativePath(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > INVESTIGATION_LIMITS.MAX_RELATIVE_PATH_LENGTH) return null
  if (ABSOLUTE_PATH_PATTERN.test(trimmed)) return null
  if (PARENT_SEGMENT_PATTERN.test(trimmed)) return null
  return trimmed
}

function parseOptionalPositiveInt(value: unknown, max: number): number | undefined | null {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) return null
  return value
}

function parseToolCall(value: unknown): InvestigationInvestigateTurn['calls'][number] | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  const allowed = new Set(['candidateRef', 'tool', 'relativePath', 'depth', 'limit'])
  if (keys.some((key) => !allowed.has(key))) return null
  if (typeof value.candidateRef !== 'string') return null
  const candidateRef = value.candidateRef.trim()
  if (!candidateRef || candidateRef.length > INVESTIGATION_LIMITS.MAX_CANDIDATE_REF_LENGTH) return null
  if (typeof value.tool !== 'string' || !isInvestigationToolName(value.tool)) return null
  const relativePath = parseRelativePath(value.relativePath)
  if (relativePath === null) return null
  const depth =
    value.tool === 'summarize_directory'
      ? parseOptionalPositiveInt(value.depth, INVESTIGATION_LIMITS.MAX_DIRECTORY_DEPTH)
      : value.depth === undefined || value.depth === null
        ? undefined
        : null
  if (depth === null) return null
  const limit =
    value.tool === 'list_children'
      ? parseOptionalPositiveInt(value.limit, INVESTIGATION_LIMITS.MAX_ENTRIES_PER_CALL)
      : value.tool === 'sample_entry_names'
        ? parseOptionalPositiveInt(value.limit, INVESTIGATION_LIMITS.MAX_SAMPLE_NAMES)
        : value.limit === undefined || value.limit === null
          ? undefined
          : null
  if (limit === null) return null
  return {
    candidateRef,
    tool: value.tool,
    relativePath,
    depth,
    limit
  }
}

function parseInvestigateTurn(parsed: Record<string, unknown>): InvestigationInvestigateTurn | null {
  if (hasForbiddenKeys(parsed)) return null
  const purpose = parsePurpose(parsed.purpose)
  if (!purpose) return null
  if (!Array.isArray(parsed.calls)) return null
  if (
    parsed.calls.length < 1 ||
    parsed.calls.length > INVESTIGATION_LIMITS.MAX_TOOL_CALLS_PER_ROUND
  ) {
    return null
  }
  const calls: InvestigationInvestigateTurn['calls'] = []
  for (const entry of parsed.calls) {
    const call = parseToolCall(entry)
    if (!call) return null
    calls.push(call)
  }
  return {
    schemaVersion: INVESTIGATION_TURN_SCHEMA_VERSION,
    action: 'investigate',
    purpose,
    calls
  }
}

function parseFinalTurn(parsed: Record<string, unknown>): InvestigationFinalTurn | null {
  if (hasForbiddenKeys(parsed)) return null
  if (!isRecord(parsed.result)) return null
  if (parsed.result.schemaVersion !== AGENT_SCHEMA_VERSION) return null
  return {
    schemaVersion: INVESTIGATION_TURN_SCHEMA_VERSION,
    action: 'final',
    result: parsed.result as unknown as InvestigationFinalTurn['result']
  }
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fence ? fence[1].trim() : trimmed
}

export function parseModelTurn(raw: string): ParsedModelTurn {
  const jsonText = stripMarkdownFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('RESPONSE_INVALID')
  }
  if (!isRecord(parsed)) throw new Error('RESPONSE_INVALID')

  if (parsed.schemaVersion === INVESTIGATION_TURN_SCHEMA_VERSION && typeof parsed.action === 'string') {
    if (parsed.action === 'investigate') {
      const investigate = parseInvestigateTurn(parsed)
      if (!investigate) throw new Error('RESPONSE_INVALID')
      return { kind: 'investigate', turn: investigate }
    }
    if (parsed.action === 'final') {
      const finalTurn = parseFinalTurn(parsed)
      if (!finalTurn) throw new Error('RESPONSE_INVALID')
      const modelParsed = parseAgentModelResponse(JSON.stringify(finalTurn.result))
      return { kind: 'final', turn: finalTurn, parsed: modelParsed }
    }
    throw new Error('RESPONSE_INVALID')
  }

  if (parsed.schemaVersion === AGENT_SCHEMA_VERSION) {
    const legacyParsed = parseAgentModelResponse(jsonText)
    return { kind: 'legacy-final', parsed: legacyParsed }
  }

  throw new Error('RESPONSE_INVALID')
}

export function parseNativeToolCalls(
  toolCalls: Array<{ function?: { name?: string; arguments?: string } }> | undefined,
  rawContent: string
): ParsedModelTurn {
  if (toolCalls && toolCalls.length > 0) {
    if (toolCalls.length > INVESTIGATION_LIMITS.MAX_TOOL_CALLS_PER_ROUND) {
      throw new Error('RESPONSE_INVALID')
    }
    const calls: InvestigationInvestigateTurn['calls'] = []
    for (const entry of toolCalls) {
      const fn = entry.function
      if (!fn?.name || !isInvestigationToolName(fn.name)) {
        throw new Error('RESPONSE_INVALID')
      }
      let args: Record<string, unknown> = {}
      if (fn.arguments) {
        try {
          const parsed = JSON.parse(fn.arguments)
          if (!isRecord(parsed)) throw new Error('RESPONSE_INVALID')
          const allowedArgKeys = new Set(['candidateRef', 'relativePath', 'depth', 'limit'])
          if (Object.keys(parsed).some((key) => !allowedArgKeys.has(key))) {
            throw new Error('RESPONSE_INVALID')
          }
          args = parsed
        } catch (error) {
          if (error instanceof Error && error.message === 'RESPONSE_INVALID') throw error
          throw new Error('RESPONSE_INVALID')
        }
      }
      const call = parseToolCall({
        candidateRef: args.candidateRef,
        tool: fn.name,
        relativePath: args.relativePath,
        depth: args.depth,
        limit: args.limit
      })
      if (!call) throw new Error('RESPONSE_INVALID')
      calls.push(call)
    }
    if (calls.length < 1) throw new Error('RESPONSE_INVALID')
    return {
      kind: 'investigate',
      turn: {
        schemaVersion: INVESTIGATION_TURN_SCHEMA_VERSION,
        action: 'investigate',
        purpose: '补充只读调查',
        calls
      }
    }
  }
  return parseModelTurn(rawContent)
}
