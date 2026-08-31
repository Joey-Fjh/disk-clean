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

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

function sanitizeMatcher(raw: unknown): UserExperienceMatcher | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const matcher: UserExperienceMatcher = {}
  const ruleId = clip(input.ruleId, 80)
  const contentType = clip(input.contentType, 80)
  const relativePathSuffix = clip(input.relativePathSuffix, USER_EXPERIENCE_LIMITS.MAX_RELATIVE_PATH_SUFFIX_LENGTH)
  const softwareName = clip(input.softwareName, USER_EXPERIENCE_LIMITS.MAX_SOFTWARE_NAME_LENGTH)
  if (ruleId) matcher.ruleId = ruleId
  if (contentType) matcher.contentType = contentType
  if (relativePathSuffix) matcher.relativePathSuffix = relativePathSuffix
  if (softwareName) matcher.softwareName = softwareName
  return Object.keys(matcher).length > 0 ? matcher : null
}

function sanitizeEntry(raw: unknown): UserExperienceEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const id = clip(input.id, 80)
  const kind = input.kind
  const name = clip(input.name, USER_EXPERIENCE_LIMITS.MAX_NAME_LENGTH)
  const reason = clip(input.reason, USER_EXPERIENCE_LIMITS.MAX_REASON_LENGTH)
  const source = input.source
  const matcher = sanitizeMatcher(input.matcher)
  if (!id || !name || !reason || !matcher) return null
  if (!ALLOWED_KINDS.has(kind as UserExperienceKind)) return null
  if (!ALLOWED_SOURCES.has(source as UserExperienceSource)) return null
  const createdAt = typeof input.createdAt === 'number' ? input.createdAt : Date.now()
  const updatedAt = typeof input.updatedAt === 'number' ? input.updatedAt : createdAt
  return {
    id,
    kind: kind as UserExperienceKind,
    name,
    enabled: input.enabled !== false,
    matcher,
    reason,
    source: source as UserExperienceSource,
    createdAt,
    updatedAt
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
  const entriesRaw = Array.isArray(input.entries) ? input.entries : []
  const entries: UserExperienceEntry[] = []
  for (const entry of entriesRaw) {
    const sanitized = sanitizeEntry(entry)
    if (sanitized) entries.push(sanitized)
    else isolated.push(entry)
  }
  const limited = entries.slice(0, USER_EXPERIENCE_LIMITS.MAX_ENTRIES)
  const changed = isolated.length > 0 || limited.length !== entriesRaw.length
  return {
    state: {
      schemaVersion: USER_EXPERIENCE_SCHEMA_VERSION,
      entries: limited
    },
    isolated,
    changed
  }
}
