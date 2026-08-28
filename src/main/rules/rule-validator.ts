import type { RuleConfig } from '../../shared/types'
import { expandEnvVars } from '../../shared/path-utils'
import {
  parseCleanupMethod,
  parseConfidence,
  parseReviewStatus
} from '../../shared/rule-enforcement'
import {
  isAbsoluteWindowsPath,
  isObviousPathEscape,
  isOverlyBroadPath,
  isRelativeRuleSegment,
  resolveContainedUnderBase
} from '../../shared/rule-match'

const ALLOWED_FIELDS = new Set([
  'id',
  'name',
  'category',
  'contentType',
  'paths',
  'patterns',
  'subdirs',
  'globDirs',
  'maxDepth',
  'maxAgeDays',
  'defaultChecked',
  'description',
  'reason',
  'impact',
  'rebuildable',
  'cleanupStrategy',
  'deletable',
  'nativeManaged',
  'source',
  'sourceUrl',
  'testedPlatforms',
  'testedVersions',
  'lastVerifiedAt',
  'requiresAppClosed',
  'cleanupMethod',
  'reviewStatus',
  'confidence',
  'exclusions',
  'notes'
])

const FORBIDDEN_FIELDS = new Set(['command', 'exec', 'script', 'shell', 'cmd', 'powershell', 'run'])

const VALID_CATEGORIES = new Set(['safe', 'recommended', 'dangerous'])
const VALID_CONTENT_TYPES = new Set([
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
const VALID_STRATEGIES = new Set(['trash', 'delete-contents', 'delete-files'])

const MAX_DEPTH_LIMIT = 12
const MAX_AGE_LIMIT = 3650

export interface RuleValidationOptions {
  builtinIds?: string[]
}

export function validateRuleInput(rule: unknown, options: RuleValidationOptions = {}): RuleConfig | null {
  if (!rule || typeof rule !== 'object') return null

  const input = rule as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_FIELDS.has(key)) return null
    if (!ALLOWED_FIELDS.has(key)) return null
  }

  const id = input.id
  const name = input.name
  const category = input.category
  const paths = input.paths

  if (typeof id !== 'string' || !id.trim()) return null
  if (options.builtinIds?.includes(id.trim())) return null
  if (typeof name !== 'string' || !name.trim()) return null
  if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) return null
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === 'string')) return null

  const expandedPaths: string[] = []
  for (const rawPath of paths) {
    if (isObviousPathEscape(rawPath)) return null
    const expanded = expandEnvVars(rawPath.trim())
    if (expanded.includes('%')) return null
    if (/^[A-Za-z]:\\?$/i.test(expanded.replace(/\\$/, ''))) return null
    if (!isAbsoluteWindowsPath(expanded)) return null
    expandedPaths.push(expanded)
  }

  const patterns = asStringArray(input.patterns)
  const subdirs = asStringArray(input.subdirs)
  const globDirs = asStringArray(input.globDirs)
  const hasPreciseScope = Boolean(patterns?.length || subdirs?.length || globDirs?.length)

  for (const expanded of expandedPaths) {
    if (!hasPreciseScope && isOverlyBroadPath(expanded)) return null
  }

  for (const list of [patterns, subdirs, globDirs]) {
    if (!list) continue
    for (const entry of list) {
      if (!isRelativeRuleSegment(entry)) return null
    }
  }

  if (subdirs?.length) {
    for (const rawPath of paths) {
      const basePath = expandEnvVars(rawPath.trim())
      for (const sub of subdirs) {
        if (!resolveContainedUnderBase(basePath, sub)) return null
      }
    }
  }

  const maxDepth = asOptionalNumber(input.maxDepth)
  const maxAgeDays = asOptionalNumber(input.maxAgeDays)
  if (maxDepth !== undefined && (maxDepth < 0 || maxDepth > MAX_DEPTH_LIMIT)) return null
  if (maxAgeDays !== undefined && (maxAgeDays < 0 || maxAgeDays > MAX_AGE_LIMIT)) return null

  if (
    input.contentType !== undefined &&
    (typeof input.contentType !== 'string' || !VALID_CONTENT_TYPES.has(input.contentType))
  ) {
    return null
  }
  if (
    input.cleanupStrategy !== undefined &&
    (typeof input.cleanupStrategy !== 'string' || !VALID_STRATEGIES.has(input.cleanupStrategy))
  ) {
    return null
  }

  const cleanupMethod = parseCleanupMethod(input.cleanupMethod)
  if (input.cleanupMethod !== undefined && cleanupMethod === undefined) return null
  const reviewStatus = parseReviewStatus(input.reviewStatus)
  if (input.reviewStatus !== undefined && reviewStatus === undefined) return null
  const confidence = parseConfidence(input.confidence)
  if (input.confidence !== undefined && confidence === undefined) return null

  if (category === 'safe' && !hasPreciseScope) return null

  let deletable = input.deletable === false ? false : undefined
  if (cleanupMethod && cleanupMethod !== 'trash') deletable = false
  if (reviewStatus === 'disabled') deletable = false

  return {
    id: id.trim(),
    name: name.trim(),
    category: category as RuleConfig['category'],
    paths: paths.map((p) => p.trim()).filter(Boolean),
    contentType: input.contentType as RuleConfig['contentType'],
    patterns,
    subdirs,
    globDirs,
    maxDepth,
    maxAgeDays,
    defaultChecked: input.defaultChecked === true,
    description: asOptionalString(input.description),
    reason: asOptionalString(input.reason),
    impact: asOptionalString(input.impact),
    rebuildable: input.rebuildable === true ? true : input.rebuildable === false ? false : undefined,
    cleanupStrategy: input.cleanupStrategy as RuleConfig['cleanupStrategy'],
    deletable,
    nativeManaged: input.nativeManaged === true ? true : undefined,
    source: asOptionalString(input.source),
    sourceUrl: asOptionalString(input.sourceUrl),
    testedPlatforms: asStringArray(input.testedPlatforms),
    testedVersions: asStringArray(input.testedVersions),
    lastVerifiedAt: asOptionalString(input.lastVerifiedAt),
    requiresAppClosed: input.requiresAppClosed === true ? true : undefined,
    cleanupMethod,
    reviewStatus,
    confidence,
    exclusions: asStringArray(input.exclusions),
    notes: asOptionalString(input.notes)
  }
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return items.length > 0 ? items : undefined
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
