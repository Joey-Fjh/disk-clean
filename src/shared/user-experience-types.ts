export const USER_EXPERIENCE_SCHEMA_VERSION = 1

export type UserExperienceKind = 'keep-exclusion' | 'recognition-hint'
export type UserExperienceSource = 'user-confirmed' | 'imported-draft'

export interface UserExperienceMatcher {
  ruleId?: string
  contentType?: string
  relativePathSuffix?: string
  softwareName?: string
}

export interface UserExperienceEntry {
  id: string
  kind: UserExperienceKind
  name: string
  enabled: boolean
  matcher: UserExperienceMatcher
  reason: string
  source: UserExperienceSource
  createdAt: number
  updatedAt: number
}

export interface UserExperienceStoreState {
  schemaVersion: number
  entries: UserExperienceEntry[]
}

export interface CreateUserExperienceInput {
  sessionId: string
  candidateId: string
  kind: UserExperienceKind
  name?: string
  reason?: string
  confirmed: boolean
}

export interface UpdateUserExperienceInput {
  id: string
  name?: string
  reason?: string
  enabled?: boolean
}
