import { USER_EXPERIENCE_LIMITS } from '../../shared/user-experience-limits'
import {
  USER_EXPERIENCE_SCHEMA_VERSION,
  type UserExperienceEntry,
  type UserExperienceKind,
  type UserExperienceMatcher,
  type UserExperienceSource,
  type UserExperienceStoreState
} from '../../shared/user-experience-types'

const ALLOWED_KINDS = new Set<UserExperienceKind>(['keep-exclusion', 'recognition-hint'])
const ALLOWED_SOURCES = new Set<UserExperienceSource>(['user-confirmed', 'imported-draft'])
const ENTRY_FIELDS = new Set([
  'id',
  'kind',
  'name',
  'enabled',
  'matcher',
  'reason',
  'source',
  'createdAt',
  'updatedAt'
])
const MATCHER_FIELDS = new Set(['ruleId', 'contentType', 'relativePathSuffix', 'softwareName'])
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function hasOnlyKeys(input: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(input).every((key) => allowed.has(key))
}

function sanitizeMatcher(raw: unknown): { matcher: UserExperienceMatcher | null; changed: boolean } {
  if (!raw || typeof raw !== 'object') return { matcher: null, changed: false }
  const input = raw as Record<string, unknown>
  const changed = !hasOnlyKeys(input, MATCHER_FIELDS)
  const matcher: UserExperienceMatcher = {}
  const ruleId = clip(input.ruleId, 80)
  const contentType = clip(input.contentType, 80)
  const relativePathSuffix = clip(input.relativePathSuffix, USER_EXPERIENCE_LIMITS.MAX_RELATIVE_PATH_SUFFIX_LENGTH)
  const softwareName = clip(input.softwareName, USER_EXPERIENCE_LIMITS.MAX_SOFTWARE_NAME_LENGTH)
  if (ruleId) matcher.ruleId = ruleId
  if (contentType) matcher.contentType = contentType
  if (relativePathSuffix) matcher.relativePathSuffix = relativePathSuffix
  if (softwareName) matcher.softwareName = softwareName
  return {
    matcher: Object.keys(matcher).length > 0 ? matcher : null,
    changed
  }
}

function sanitizeEntry(raw: unknown): { entry: UserExperienceEntry | null; changed: boolean } {
  if (!raw || typeof raw !== 'object') return { entry: null, changed: false }
  const input = raw as Record<string, unknown>
  let changed = !hasOnlyKeys(input, ENTRY_FIELDS)
  const id = clip(input.id, USER_EXPERIENCE_LIMITS.MAX_ID_LENGTH)
  const kind = input.kind
  const name = clip(input.name, USER_EXPERIENCE_LIMITS.MAX_NAME_LENGTH)
  const reason = clip(input.reason, USER_EXPERIENCE_LIMITS.MAX_REASON_LENGTH)
  const source = input.source
  const { matcher, changed: matcherChanged } = sanitizeMatcher(input.matcher)
  changed = changed || matcherChanged
  if (!id || !ID_PATTERN.test(id)) return { entry: null, changed }
  if (!name || !reason || !matcher) return { entry: null, changed }
  if (!ALLOWED_KINDS.has(kind as UserExperienceKind)) return { entry: null, changed }
  if (!ALLOWED_SOURCES.has(source as UserExperienceSource)) return { entry: null, changed }
  if (!isFiniteNonNegativeNumber(input.createdAt) || !isFiniteNonNegativeNumber(input.updatedAt)) {
    return { entry: null, changed: false }
  }
  const createdAt = input.createdAt
  const updatedAt = input.updatedAt
  return {
    entry: {
      id,
      kind: kind as UserExperienceKind,
      name,
      enabled: input.enabled !== false,
      matcher,
      reason,
      source: source as UserExperienceSource,
      createdAt,
      updatedAt
    },
    changed
  }
}

export function assertUserExperienceJsonSize(raw: string): void {
  if (Buffer.byteLength(raw, 'utf-8') > USER_EXPERIENCE_LIMITS.MAX_JSON_BYTES) {
    throw new Error('经验数据过大')
  }
}

export function sanitizeUserExperienceStore(raw: unknown): {
  state: UserExperienceStoreState
  isolated: unknown[]
  changed: boolean
} {
  const isolated: unknown[] = []
  if (!raw || typeof raw !== 'object') {
    return {
      state: { schemaVersion: USER_EXPERIENCE_SCHEMA_VERSION, entries: [] },
      isolated: [raw],
      changed: true
    }
  }
  const input = raw as Record<string, unknown>
  let changed = Object.keys(input).some((key) => key !== 'schemaVersion' && key !== 'entries')
  if (input.schemaVersion !== USER_EXPERIENCE_SCHEMA_VERSION) {
    changed = true
  }
  const entriesRaw = Array.isArray(input.entries) ? input.entries : []
  if (!Array.isArray(input.entries)) changed = true
  const entries: UserExperienceEntry[] = []
  const seenIds = new Set<string>()
  for (const entry of entriesRaw) {
    const { entry: sanitized, changed: entryChanged } = sanitizeEntry(entry)
    changed = changed || entryChanged
    if (!sanitized) {
      isolated.push(entry)
      continue
    }
    if (seenIds.has(sanitized.id)) {
      isolated.push(entry)
      changed = true
      continue
    }
    seenIds.add(sanitized.id)
    entries.push(sanitized)
  }
  const limited = entries.slice(0, USER_EXPERIENCE_LIMITS.MAX_ENTRIES)
  if (limited.length !== entries.length) changed = true
  return {
    state: {
      schemaVersion: USER_EXPERIENCE_SCHEMA_VERSION,
      entries: limited
    },
    isolated,
    changed
  }
}
