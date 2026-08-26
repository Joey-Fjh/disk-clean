import type { RuleDraftV1 } from '../../shared/rule-layer-types'
import { RULE_DRAFT_LIMITS } from '../../shared/rule-draft-limits'
import { isOverlyBroadPath, resolveContainedUnderBase } from '../../shared/rule-match'
import { expandEnvVars } from '../../shared/path-utils'
import { RuleDraftValidationError } from './rule-draft-validator'

const LITERAL_SEGMENT_RE = /^[A-Za-z0-9._-]+$/
const FORBIDDEN_GLOB_SYNTAX_RE = /[{}\[\]!@+?]|@\(|@\!/

export const MAX_APPROVABLE_RULE_TARGETS = 50

export function isBroadBasePlaceholder(placeholder: string): boolean {
  if (placeholder === '%ProgramData%') return true
  const expanded = expandEnvVars(placeholder)
  if (expanded.includes('%')) return true
  return isOverlyBroadPath(expanded)
}

function draftUsesBroadBase(draft: RuleDraftV1): boolean {
  return draft.basePlaceholders.some((placeholder) => isBroadBasePlaceholder(placeholder))
}

function normalizeScopeEntry(entry: string): string {
  return entry.trim().replace(/\\/g, '/')
}

function rejectForbiddenGlobSyntax(entry: string): void {
  if (FORBIDDEN_GLOB_SYNTAX_RE.test(entry)) {
    throw new RuleDraftValidationError('相对模式包含不允许的 glob 语法')
  }
}

function isLiteralSegment(segment: string): boolean {
  return LITERAL_SEGMENT_RE.test(segment)
}

export function validateScopeFieldExclusivity(draft: RuleDraftV1): void {
  const count = [draft.relativePatterns, draft.subdirs, draft.globDirs].filter(
    (list) => list && list.length > 0
  ).length
  if (count !== 1) {
    throw new RuleDraftValidationError('relativePatterns、subdirs、globDirs 只能三选一')
  }
}

function validateSubdirEntry(entry: string): void {
  const normalized = normalizeScopeEntry(entry)
  if (!normalized || normalized.includes('..')) {
    throw new RuleDraftValidationError('subdirs 只允许字面相对路径')
  }
  rejectForbiddenGlobSyntax(normalized)
  if (normalized.includes('*')) {
    throw new RuleDraftValidationError('subdirs 不允许 glob 元字符')
  }
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0 || !segments.every(isLiteralSegment)) {
    throw new RuleDraftValidationError('subdirs 只允许字面相对路径')
  }
}

function validateGlobSegment(segment: string, broadBase: boolean, index: number, lastIndex: number): void {
  if (segment === '**') {
    if (index !== lastIndex) {
      throw new RuleDraftValidationError('globDirs 中 ** 只能出现在末尾')
    }
    return
  }
  if (segment === '*') {
    if (broadBase && index === 0) {
      throw new RuleDraftValidationError('宽泛 base 下 globDirs 首段不能为通配符')
    }
    return
  }
  if (!isLiteralSegment(segment)) {
    throw new RuleDraftValidationError('globDirs 段必须是字面目录或单段 * / 末尾 **')
  }
}

function validateGlobDirEntry(entry: string, broadBase: boolean): void {
  const normalized = normalizeScopeEntry(entry)
  if (!normalized || normalized.includes('..')) {
    throw new RuleDraftValidationError('globDirs 无效')
  }
  rejectForbiddenGlobSyntax(normalized)

  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) {
    throw new RuleDraftValidationError('globDirs 必须包含字面目录锚点')
  }
  if (segments[0] === '*' || segments[0] === '**') {
    throw new RuleDraftValidationError('globDirs 必须以字面目录锚点开头')
  }
  if (broadBase && !isLiteralSegment(segments[0])) {
    throw new RuleDraftValidationError('宽泛 base 下 globDirs 首段必须是字面目录')
  }

  const lastIndex = segments.length - 1
  let literalCount = 0
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    validateGlobSegment(segment, broadBase, index, lastIndex)
    if (isLiteralSegment(segment)) literalCount += 1
  }
  if (literalCount === 0) {
    throw new RuleDraftValidationError('globDirs 必须包含字面目录锚点')
  }
}

function validateRelativePatternEntry(entry: string, broadBase: boolean): void {
  if (broadBase) {
    throw new RuleDraftValidationError('宽泛 base 下不允许 relativePatterns')
  }
  const normalized = normalizeScopeEntry(entry)
  if (!normalized || normalized.includes('..')) {
    throw new RuleDraftValidationError('relativePatterns 无效')
  }
  rejectForbiddenGlobSyntax(normalized)

  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) {
    throw new RuleDraftValidationError('relativePatterns 无效')
  }
  if (segments.length > 1 && !isLiteralSegment(segments[0])) {
    throw new RuleDraftValidationError('relativePatterns 首段必须是字面目录')
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment === '*') continue
    if (segment.includes('*')) {
      if (!/^\*\.[A-Za-z0-9._-]+$/.test(segment) && segment !== '*') {
        throw new RuleDraftValidationError('relativePatterns 仅允许简单文件名通配')
      }
      continue
    }
    if (!isLiteralSegment(segment)) {
      throw new RuleDraftValidationError('relativePatterns 含不允许的 glob 语法')
    }
  }
}

export function validateDraftRelativePatterns(draft: RuleDraftV1): void {
  validateScopeFieldExclusivity(draft)
  const broadBase = draftUsesBroadBase(draft)

  if (draft.subdirs?.length) {
    for (const entry of draft.subdirs) validateSubdirEntry(entry)
    return
  }
  if (draft.globDirs?.length) {
    for (const entry of draft.globDirs) validateGlobDirEntry(entry, broadBase)
    return
  }
  if (draft.relativePatterns?.length) {
    for (const entry of draft.relativePatterns) validateRelativePatternEntry(entry, broadBase)
  }
}

export function assertDraftScopePrecision(draft: RuleDraftV1): void {
  validateDraftRelativePatterns(draft)

  if (draft.subdirs?.length) {
    for (const placeholder of draft.basePlaceholders) {
      const expanded = expandEnvVars(placeholder)
      if (expanded.includes('%')) {
        throw new RuleDraftValidationError('占位符无法解析')
      }
      if (/^[A-Za-z]:\\?$/.test(expanded)) {
        throw new RuleDraftValidationError('禁止盘符根目录')
      }
      for (const sub of draft.subdirs) {
        if (!resolveContainedUnderBase(expanded, sub)) {
          throw new RuleDraftValidationError('相对范围超出 base 边界')
        }
      }
    }
    return
  }

  if (draft.globDirs?.length || draft.relativePatterns?.length) {
    for (const placeholder of draft.basePlaceholders) {
      const expanded = expandEnvVars(placeholder)
      if (expanded.includes('%')) {
        throw new RuleDraftValidationError('占位符无法解析')
      }
      if (/^[A-Za-z]:\\?$/.test(expanded)) {
        throw new RuleDraftValidationError('禁止盘符根目录')
      }
    }
  }
}

export function isDriveRootPlaceholder(placeholder: string): boolean {
  return /^[A-Za-z]:\\?$/.test(expandEnvVars(placeholder))
}

export function exceedsApprovalTargetLimit(targetCount: number): boolean {
  return targetCount > MAX_APPROVABLE_RULE_TARGETS
}

export function exceedsApprovalMatchLimit(matchCount: number): boolean {
  return matchCount > RULE_DRAFT_LIMITS.MAX_CANDIDATES_PER_REQUEST * 8
}

export function enforceDraftRuleTargetLimit<T extends { id: string; deletable?: boolean }>(
  rule: T,
  targetCount: number
): { rule: T; downgraded: boolean; message?: string } {
  if (!rule.id.startsWith('draft:') || !exceedsApprovalTargetLimit(targetCount)) {
    return { rule, downgraded: false }
  }
  return {
    rule: { ...rule, deletable: false },
    downgraded: true,
    message: `草稿规则目标 ${targetCount} 超过上限 ${MAX_APPROVABLE_RULE_TARGETS}，已降级为仅识别`
  }
}
