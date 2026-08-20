import type { RuleConfig } from '../../shared/types'

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
  'deletable'
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

export function validateRuleInput(rule: unknown): RuleConfig | null {
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
  if (typeof name !== 'string' || !name.trim()) return null
  if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) return null
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === 'string')) return null

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

  return {
    id: id.trim(),
    name: name.trim(),
    category: category as RuleConfig['category'],
    paths: paths.map((p) => p.trim()).filter(Boolean),
    contentType: input.contentType as RuleConfig['contentType'],
    patterns: asStringArray(input.patterns),
    subdirs: asStringArray(input.subdirs),
    globDirs: asStringArray(input.globDirs),
    maxDepth: asOptionalNumber(input.maxDepth),
    maxAgeDays: asOptionalNumber(input.maxAgeDays),
    defaultChecked: input.defaultChecked === true,
    description: asOptionalString(input.description),
    reason: asOptionalString(input.reason),
    impact: asOptionalString(input.impact),
    rebuildable: input.rebuildable === true ? true : input.rebuildable === false ? false : undefined,
    cleanupStrategy: input.cleanupStrategy as RuleConfig['cleanupStrategy'],
    deletable: input.deletable === false ? false : undefined
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
