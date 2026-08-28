import type { ContentType } from '../../shared/types'
import {
  RULE_DRAFT_ALLOWED_PLACEHOLDERS,
  RULE_DRAFT_FORBIDDEN_FIELDS,
  RULE_DRAFT_LIMITS
} from '../../shared/rule-draft-limits'
import type { RuleDraftV1, SuggestedRisk } from '../../shared/rule-layer-types'
import { RULE_DRAFT_SCHEMA_VERSION } from '../../shared/rule-layer-types'
import { validateDraftRelativePatterns } from './rule-draft-scope'

const VALID_RISKS = new Set<SuggestedRisk>(['safe', 'recommended', 'dangerous'])
const VALID_CONTENT_TYPES = new Set<ContentType>([
  'system-temp',
  'browser-cache',
  'app-cache',
  'app-logs',
  'download-leftover',
  'recycle-bin',
  'install-leftover',
  'large-file',
  'large-dir',
  'user-data',
  'system-protected',
  'developer',
  'agent',
  'game',
  'chat'
])

const ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'name',
  'contentType',
  'basePlaceholders',
  'relativePatterns',
  'subdirs',
  'globDirs',
  'maxDepth',
  'maxAgeDays',
  'reason',
  'impact',
  'rebuildable',
  'requiresAppClosed',
  'suggestedRisk',
  'source',
  'generatedFromSessionId',
  'generatedFromCandidateIds',
  'createdAt'
])

export class RuleDraftValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleDraftValidationError'
  }
}

function asStringArray(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
  if (items.length > max) throw new RuleDraftValidationError('数组项过多')
  return items.length > 0 ? items : undefined
}

function containsAbsolutePath(text: string): boolean {
  return /[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\')
}

export function validateRuleDraftInput(input: unknown): RuleDraftV1 {
  if (!input || typeof input !== 'object') {
    throw new RuleDraftValidationError('草稿格式无效')
  }

  const record = input as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (RULE_DRAFT_FORBIDDEN_FIELDS.includes(key as (typeof RULE_DRAFT_FORBIDDEN_FIELDS)[number])) {
      throw new RuleDraftValidationError(`禁止字段：${key}`)
    }
    if (!ALLOWED_FIELDS.has(key)) {
      throw new RuleDraftValidationError(`未知字段：${key}`)
    }
  }

  if (record.schemaVersion !== RULE_DRAFT_SCHEMA_VERSION) {
    throw new RuleDraftValidationError('不支持的 schemaVersion')
  }

  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!name || name.length > RULE_DRAFT_LIMITS.MAX_NAME_LENGTH) {
    throw new RuleDraftValidationError('名称无效')
  }

  const contentType = record.contentType
  if (typeof contentType !== 'string' || !VALID_CONTENT_TYPES.has(contentType as ContentType)) {
    throw new RuleDraftValidationError('内容类型无效')
  }

  const basePlaceholders = asStringArray(record.basePlaceholders, RULE_DRAFT_LIMITS.MAX_BASE_PLACEHOLDERS)
  if (!basePlaceholders || basePlaceholders.length === 0) {
    throw new RuleDraftValidationError('必须提供 basePlaceholders')
  }
  for (const placeholder of basePlaceholders) {
    if (!RULE_DRAFT_ALLOWED_PLACEHOLDERS.has(placeholder)) {
      throw new RuleDraftValidationError(`不允许的占位符：${placeholder}`)
    }
    if (containsAbsolutePath(placeholder)) {
      throw new RuleDraftValidationError('basePlaceholders 不得包含绝对路径')
    }
  }

  const relativePatterns = asStringArray(record.relativePatterns, RULE_DRAFT_LIMITS.MAX_ARRAY_ITEMS)
  const subdirs = asStringArray(record.subdirs, RULE_DRAFT_LIMITS.MAX_ARRAY_ITEMS)
  const globDirs = asStringArray(record.globDirs, RULE_DRAFT_LIMITS.MAX_ARRAY_ITEMS)
  const scopeFieldCount = [relativePatterns, subdirs, globDirs].filter((list) => list && list.length > 0)
    .length
  if (scopeFieldCount !== 1) {
    throw new RuleDraftValidationError('relativePatterns、subdirs、globDirs 只能三选一')
  }

  for (const list of [relativePatterns, subdirs, globDirs]) {
    if (!list) continue
    for (const entry of list) {
      if (containsAbsolutePath(entry) || entry.includes('..')) {
        throw new RuleDraftValidationError('相对模式不得包含绝对路径或目录穿越')
      }
    }
  }

  const maxDepth =
    typeof record.maxDepth === 'number' && Number.isFinite(record.maxDepth)
      ? record.maxDepth
      : undefined
  const maxAgeDays =
    typeof record.maxAgeDays === 'number' && Number.isFinite(record.maxAgeDays)
      ? record.maxAgeDays
      : undefined
  if (maxDepth !== undefined && (maxDepth < 0 || maxDepth > RULE_DRAFT_LIMITS.MAX_DEPTH)) {
    throw new RuleDraftValidationError('maxDepth 超出范围')
  }
  if (maxAgeDays !== undefined && (maxAgeDays < 0 || maxAgeDays > RULE_DRAFT_LIMITS.MAX_AGE_DAYS)) {
    throw new RuleDraftValidationError('maxAgeDays 超出范围')
  }

  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  if (!reason || reason.length > RULE_DRAFT_LIMITS.MAX_REASON_LENGTH) {
    throw new RuleDraftValidationError('reason 无效')
  }

  const impact =
    typeof record.impact === 'string' && record.impact.trim()
      ? record.impact.trim().slice(0, RULE_DRAFT_LIMITS.MAX_IMPACT_LENGTH)
      : undefined

  const suggestedRisk = record.suggestedRisk
  if (typeof suggestedRisk !== 'string' || !VALID_RISKS.has(suggestedRisk as SuggestedRisk)) {
    throw new RuleDraftValidationError('suggestedRisk 无效')
  }

  const source = record.source
  if (source !== 'agent-generated' && source !== 'user-import' && source !== 'legacy-user') {
    throw new RuleDraftValidationError('source 无效')
  }

  const createdAt =
    typeof record.createdAt === 'string' && record.createdAt.trim()
      ? record.createdAt.trim()
      : new Date().toISOString()

  const generatedFromCandidateIds = asStringArray(
    record.generatedFromCandidateIds,
    RULE_DRAFT_LIMITS.MAX_CANDIDATES_PER_REQUEST
  )
  const generatedFromSessionId =
    typeof record.generatedFromSessionId === 'string' ? record.generatedFromSessionId.trim() : undefined

  const draft: RuleDraftV1 = {
    schemaVersion: RULE_DRAFT_SCHEMA_VERSION,
    name,
    contentType: contentType as ContentType,
    basePlaceholders,
    relativePatterns,
    subdirs,
    globDirs,
    maxDepth,
    maxAgeDays,
    reason,
    impact,
    rebuildable: record.rebuildable === true ? true : record.rebuildable === false ? false : undefined,
    requiresAppClosed: record.requiresAppClosed === true ? true : undefined,
    suggestedRisk: suggestedRisk as SuggestedRisk,
    source,
    generatedFromSessionId,
    generatedFromCandidateIds,
    createdAt
  }

  validateDraftRelativePatterns(draft)
  return draft
}
