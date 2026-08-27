import { INVESTIGATION_LIMITS } from './investigation-limits'
import type { InvestigationToolName } from './investigation-limits'
import type { InvestigationToolRequest } from './investigation-types'

const NULL_BYTE = /\0/
const ABSOLUTE_PATH = /^([a-zA-Z]:[\\/]|\\\\)/
const PARENT_SEGMENT = /(^|[\\/])\.\.([\\/]|$)/

export class InvestigationValidationError extends Error {
  readonly code: 'INVALID_INPUT' | 'INVALID_RELATIVE_PATH'

  constructor(code: 'INVALID_INPUT' | 'INVALID_RELATIVE_PATH', message: string) {
    super(message)
    this.name = 'InvestigationValidationError'
    this.code = code
  }
}

function assertStringLength(value: string, max: number, code: 'INVALID_INPUT' | 'INVALID_RELATIVE_PATH', message: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) {
    throw new InvestigationValidationError(code, message)
  }
  return trimmed
}

export function validateSessionId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvestigationValidationError('INVALID_INPUT', '无效的扫描会话')
  }
  return assertStringLength(value, INVESTIGATION_LIMITS.MAX_SESSION_ID_LENGTH, 'INVALID_INPUT', '无效的扫描会话')
}

export function validateCandidateRef(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvestigationValidationError('INVALID_INPUT', '无效的候选引用')
  }
  return assertStringLength(value, INVESTIGATION_LIMITS.MAX_CANDIDATE_REF_LENGTH, 'INVALID_INPUT', '无效的候选引用')
}

export function validateRelativePathInput(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new InvestigationValidationError('INVALID_RELATIVE_PATH', '相对路径无效')
  }
  const trimmed = value.trim()
  if (trimmed.length > INVESTIGATION_LIMITS.MAX_RELATIVE_PATH_LENGTH) {
    throw new InvestigationValidationError('INVALID_RELATIVE_PATH', '相对路径无效')
  }
  if (NULL_BYTE.test(trimmed)) {
    throw new InvestigationValidationError('INVALID_RELATIVE_PATH', '相对路径无效')
  }
  if (ABSOLUTE_PATH.test(trimmed)) {
    throw new InvestigationValidationError('INVALID_RELATIVE_PATH', '不允许绝对路径')
  }
  if (PARENT_SEGMENT.test(trimmed)) {
    throw new InvestigationValidationError('INVALID_RELATIVE_PATH', '不允许路径穿越')
  }
  return trimmed
}

function validatePositiveInteger(
  value: unknown,
  min: number,
  max: number,
  label: string
): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new InvestigationValidationError('INVALID_INPUT', `无效的${label}`)
  }
  if (value < min || value > max) {
    throw new InvestigationValidationError('INVALID_INPUT', `无效的${label}`)
  }
  return value
}

export function validateListLimit(value: unknown): number | undefined {
  return validatePositiveInteger(value, 1, INVESTIGATION_LIMITS.MAX_ENTRIES_PER_CALL, 'limit')
}

export function validateSampleLimit(value: unknown): number | undefined {
  return validatePositiveInteger(value, 1, INVESTIGATION_LIMITS.MAX_SAMPLE_NAMES, 'limit')
}

export function validateDepth(value: unknown): number | undefined {
  return validatePositiveInteger(value, 0, INVESTIGATION_LIMITS.MAX_DIRECTORY_DEPTH, 'depth')
}

export function normalizeToolLimit(toolName: InvestigationToolName, limit?: number): number | undefined {
  if (limit === undefined) return undefined
  if (toolName === 'list_children') return validateListLimit(limit)
  if (toolName === 'sample_entry_names') return validateSampleLimit(limit)
  throw new InvestigationValidationError('INVALID_INPUT', '无效的 limit')
}

export function normalizeToolDepth(depth?: number): number | undefined {
  if (depth === undefined) return undefined
  return validateDepth(depth)
}

export function rejectUnexpectedLimit(toolName: InvestigationToolName, limit: unknown): void {
  if (limit !== undefined && limit !== null && toolName === 'summarize_directory') {
    throw new InvestigationValidationError('INVALID_INPUT', '无效的 limit')
  }
}

export function rejectUnexpectedDepth(toolName: InvestigationToolName, depth: unknown): void {
  if (depth !== undefined && depth !== null && toolName !== 'summarize_directory') {
    throw new InvestigationValidationError('INVALID_INPUT', '无效的 depth')
  }
}

export function normalizeInvestigationToolRequest(input: {
  sessionId: string
  candidateRef: string
  toolName: InvestigationToolName
  relativePath?: string
  limit?: number
  depth?: number
}): InvestigationToolRequest {
  rejectUnexpectedLimit(input.toolName, input.limit)
  rejectUnexpectedDepth(input.toolName, input.depth)
  const relativePath = input.relativePath === undefined ? undefined : validateRelativePathInput(input.relativePath)
  return {
    sessionId: input.sessionId,
    candidateRef: input.candidateRef,
    toolName: input.toolName,
    relativePath,
    limit: normalizeToolLimit(input.toolName, input.limit),
    depth: input.toolName === 'summarize_directory' ? normalizeToolDepth(input.depth) : undefined
  }
}
