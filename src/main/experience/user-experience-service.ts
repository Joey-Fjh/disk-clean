import { randomUUID } from 'crypto'
import type { ScanCandidate } from '../../shared/types'
import { normalizePath } from '../../shared/path-utils'
import { USER_EXPERIENCE_LIMITS } from '../../shared/user-experience-limits'
import type {
  CreateUserExperienceInput,
  UpdateUserExperienceInput,
  UserExperienceEntry,
  UserExperienceMatcher
} from '../../shared/user-experience-types'
import { getScanSession } from '../scan/scan-session-store'
import { loadUserExperienceStore, saveUserExperienceStore } from './user-experience-store'

export class UserExperienceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'UserExperienceError'
  }
}

function buildRelativePathSuffix(path: string, drive: string): string {
  const normalized = normalizePath(path)
  const driveRoot = drive && drive !== 'all' ? `${drive.replace(/:$/, '')}:\\` : ''
  if (driveRoot && normalized.toLowerCase().startsWith(driveRoot.toLowerCase())) {
    return normalized.slice(driveRoot.length).slice(0, USER_EXPERIENCE_LIMITS.MAX_RELATIVE_PATH_SUFFIX_LENGTH)
  }
  const segments = normalized.split('\\').filter(Boolean)
  return segments.slice(-3).join('\\').slice(0, USER_EXPERIENCE_LIMITS.MAX_RELATIVE_PATH_SUFFIX_LENGTH)
}

function buildMatcher(candidate: ScanCandidate, drive: string): UserExperienceMatcher {
  const matcher: UserExperienceMatcher = {
    ruleId: candidate.ruleId,
    contentType: candidate.contentType,
    relativePathSuffix: buildRelativePathSuffix(candidate.path, drive)
  }
  const softwareName = candidate.ruleName?.trim()
  if (softwareName) matcher.softwareName = softwareName.slice(0, USER_EXPERIENCE_LIMITS.MAX_SOFTWARE_NAME_LENGTH)
  return matcher
}

function resolveCandidate(sessionId: string, candidateId: string): { candidate: ScanCandidate; drive: string } {
  const session = getScanSession(sessionId)
  if (!session) throw new UserExperienceError('SESSION_NOT_FOUND', '扫描会话已过期，请重新扫描')
  const candidate = session.candidates.get(candidateId)
  if (!candidate) throw new UserExperienceError('CANDIDATE_NOT_FOUND', '候选项不存在或已失效')
  return { candidate, drive: session.drive }
}

export function listUserExperiences(): UserExperienceEntry[] {
  return loadUserExperienceStore().entries
}

export function createUserExperience(input: CreateUserExperienceInput): UserExperienceEntry {
  if (!input.confirmed) {
    throw new UserExperienceError('CONFIRMATION_REQUIRED', '保存经验前需要用户确认')
  }
  const { candidate, drive } = resolveCandidate(input.sessionId, input.candidateId)
  const store = loadUserExperienceStore()
  if (store.entries.length >= USER_EXPERIENCE_LIMITS.MAX_ENTRIES) {
    throw new UserExperienceError('LIMIT_REACHED', '经验条目已达上限')
  }
  const now = Date.now()
  const name =
    input.name?.trim().slice(0, USER_EXPERIENCE_LIMITS.MAX_NAME_LENGTH) ||
    candidate.ruleName ||
    candidate.path.split('\\').pop() ||
    '用户经验'
  const reason =
    input.reason?.trim().slice(0, USER_EXPERIENCE_LIMITS.MAX_REASON_LENGTH) ||
    `用户确认保留：${candidate.ruleName || candidate.contentType}`
  const entry: UserExperienceEntry = {
    id: randomUUID(),
    kind: input.kind,
    name,
    enabled: true,
    matcher: buildMatcher(candidate, drive),
    reason,
    source: 'user-confirmed',
    createdAt: now,
    updatedAt: now
  }
  store.entries.unshift(entry)
  saveUserExperienceStore(store)
  return entry
}

export function updateUserExperience(input: UpdateUserExperienceInput): UserExperienceEntry | null {
  const store = loadUserExperienceStore()
  const index = store.entries.findIndex((entry) => entry.id === input.id)
  if (index < 0) return null
  const current = store.entries[index]
  const next: UserExperienceEntry = {
    ...current,
    name: input.name?.trim().slice(0, USER_EXPERIENCE_LIMITS.MAX_NAME_LENGTH) ?? current.name,
    reason: input.reason?.trim().slice(0, USER_EXPERIENCE_LIMITS.MAX_REASON_LENGTH) ?? current.reason,
    enabled: input.enabled ?? current.enabled,
    updatedAt: Date.now()
  }
  store.entries[index] = next
  saveUserExperienceStore(store)
  return next
}

export function deleteUserExperience(id: string): boolean {
  const store = loadUserExperienceStore()
  const next = store.entries.filter((entry) => entry.id !== id)
  if (next.length === store.entries.length) return false
  saveUserExperienceStore({ ...store, entries: next })
  return true
}

export function getEnabledUserExperiences(): UserExperienceEntry[] {
  try {
    return loadUserExperienceStore().entries.filter((entry) => entry.enabled)
  } catch {
    return []
  }
}
