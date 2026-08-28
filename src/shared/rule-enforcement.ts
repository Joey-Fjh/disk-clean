import type { RuleConfig } from './types'

export const VALID_CLEANUP_METHODS = ['trash', 'system-managed', 'uninstall', 'manual'] as const
export const VALID_REVIEW_STATUSES = ['verified', 'conservative', 'disabled'] as const
export const VALID_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const

export type CleanupMethod = (typeof VALID_CLEANUP_METHODS)[number]
export type ReviewStatus = (typeof VALID_REVIEW_STATUSES)[number]
export type RuleConfidence = (typeof VALID_CONFIDENCE_LEVELS)[number]

const CLEANUP_METHOD_SET = new Set<string>(VALID_CLEANUP_METHODS)
const REVIEW_STATUS_SET = new Set<string>(VALID_REVIEW_STATUSES)
const CONFIDENCE_SET = new Set<string>(VALID_CONFIDENCE_LEVELS)

export function parseCleanupMethod(value: unknown): CleanupMethod | undefined {
  if (typeof value !== 'string' || !CLEANUP_METHOD_SET.has(value)) return undefined
  return value as CleanupMethod
}

export function parseReviewStatus(value: unknown): ReviewStatus | undefined {
  if (typeof value !== 'string' || !REVIEW_STATUS_SET.has(value)) return undefined
  return value as ReviewStatus
}

export function parseConfidence(value: unknown): RuleConfidence | undefined {
  if (typeof value !== 'string' || !CONFIDENCE_SET.has(value)) return undefined
  return value as RuleConfidence
}

/** 规则是否参与扫描与执行（disabled 规则完全隔离）。 */
export function isRuleActiveForScan(rule: Pick<RuleConfig, 'reviewStatus'>): boolean {
  return rule.reviewStatus !== 'disabled'
}

/** 规则元数据是否禁止普通移入回收站（扫描与 Validator 双层约束）。 */
export function isRuleMetadataDeleteForbidden(
  rule: Pick<RuleConfig, 'cleanupMethod' | 'reviewStatus' | 'deletable' | 'category' | 'nativeManaged'>
): boolean {
  if (rule.reviewStatus === 'disabled') return true
  if (rule.deletable === false) return true
  if (rule.category === 'dangerous') return true
  if (rule.nativeManaged) return true
  const method = rule.cleanupMethod
  if (method && method !== 'trash') return true
  return false
}

/** 规则是否允许授予普通删除授权（须同时满足元数据与显式字段）。 */
export function isRuleOrdinaryDeletable(
  rule: Pick<
    RuleConfig,
    'cleanupMethod' | 'reviewStatus' | 'deletable' | 'category' | 'nativeManaged'
  >
): boolean {
  if (!isRuleActiveForScan(rule)) return false
  return !isRuleMetadataDeleteForbidden(rule)
}

export type RuleMetadataField = 'cleanupMethod' | 'reviewStatus' | 'confidence'

/** 检测“字段存在但非法”（与字段缺失区分）。 */
export function detectInvalidRuleMetadataFields(
  rule: Pick<RuleConfig, 'cleanupMethod' | 'reviewStatus' | 'confidence'>
): RuleMetadataField[] {
  const invalid: RuleMetadataField[] = []
  if (rule.cleanupMethod !== undefined && parseCleanupMethod(rule.cleanupMethod) === undefined) {
    invalid.push('cleanupMethod')
  }
  if (rule.reviewStatus !== undefined && parseReviewStatus(rule.reviewStatus) === undefined) {
    invalid.push('reviewStatus')
  }
  if (rule.confidence !== undefined && parseConfidence(rule.confidence) === undefined) {
    invalid.push('confidence')
  }
  return invalid
}

export function normalizeRuleMetadata<T extends RuleConfig>(rule: T): T {
  const cleanupMethod = parseCleanupMethod(rule.cleanupMethod)
  const reviewStatus = parseReviewStatus(rule.reviewStatus)
  const confidence = parseConfidence(rule.confidence)

  let deletable = rule.deletable
  if (cleanupMethod && cleanupMethod !== 'trash') {
    deletable = false
  }
  if (reviewStatus === 'disabled') {
    deletable = false
  }

  return {
    ...rule,
    cleanupMethod,
    reviewStatus,
    confidence,
    deletable: deletable === false ? false : undefined
  }
}

/** 官方/兼容加载：非法安全元数据隔离为 disabled + 不可删除，禁止静默剥离字段后继续参与扫描。 */
export function sanitizeRuleForLoad<T extends RuleConfig>(rule: T): T {
  const invalidFields = detectInvalidRuleMetadataFields(rule)
  const normalized = normalizeRuleMetadata(rule)
  if (invalidFields.length === 0) return normalized

  const note = `元数据校验失败已隔离：${invalidFields.join(', ')}`
  const notes = normalized.notes ? `${normalized.notes}; ${note}` : note

  return {
    ...normalized,
    reviewStatus: 'disabled',
    deletable: false,
    notes
  }
}
