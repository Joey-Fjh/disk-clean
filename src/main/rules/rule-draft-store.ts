import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  RuleDraftOrigin,
  RuleDraftStatus,
  RuleDraftStoreState,
  StoredRuleDraft,
  UserRulePackState
} from '../../shared/rule-layer-types'
import { RULE_DRAFT_LIMITS } from '../../shared/rule-draft-limits'
import { RULE_DRAFT_SCHEMA_VERSION, RULE_PACK_SCHEMA_VERSION } from '../../shared/rule-layer-types'
import type { RuleDraftV1 } from '../../shared/rule-layer-types'
import { validateRuleDraftInput } from './rule-draft-validator'
import {
  assertImportJsonSize,
  sanitizeDraftStore,
  sanitizeUserPackStore
} from './rule-store-sanitizer'

function getStoreDir(): string {
  const dir = join(app.getPath('userData'), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function draftStorePath(): string {
  return join(getStoreDir(), 'rule-drafts.json')
}

function userPackStorePath(): string {
  return join(getStoreDir(), 'user-rule-packs.json')
}

function isolatedDraftsPath(): string {
  return join(getStoreDir(), 'rule-drafts-isolated.json')
}

function isolatedPacksPath(): string {
  return join(getStoreDir(), 'user-rule-packs-isolated.json')
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf-8')
  renameSync(temp, path)
}

function appendIsolated(path: string, entries: unknown[]): void {
  if (entries.length === 0) return
  let existing: unknown[] = []
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { entries?: unknown[] }
      existing = Array.isArray(parsed.entries) ? parsed.entries : []
    } catch {
      existing = []
    }
  }
  writeJsonAtomic(path, {
    updatedAt: new Date().toISOString(),
    entries: [...entries, ...existing].slice(0, 100)
  })
}

function loadDraftStore(): RuleDraftStoreState {
  const path = draftStorePath()
  if (!existsSync(path)) {
    return { schemaVersion: RULE_DRAFT_SCHEMA_VERSION, drafts: [], migrationCompleted: false }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const { state, isolated, changed } = sanitizeDraftStore(parsed)
    if (isolated.length > 0) appendIsolated(isolatedDraftsPath(), isolated)
    if (changed) saveDraftStore(state)
    return state
  } catch {
    return { schemaVersion: RULE_DRAFT_SCHEMA_VERSION, drafts: [], migrationCompleted: false }
  }
}

function saveDraftStore(state: RuleDraftStoreState): void {
  if (state.drafts.length > RULE_DRAFT_LIMITS.MAX_DRAFTS) {
    state.drafts = state.drafts.slice(-RULE_DRAFT_LIMITS.MAX_DRAFTS)
  }
  writeJsonAtomic(draftStorePath(), state)
}

export function loadUserRulePackState(): UserRulePackState {
  const path = userPackStorePath()
  if (!existsSync(path)) {
    return { schemaVersion: RULE_PACK_SCHEMA_VERSION, disabledPackIds: [], packs: [] }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const { state, isolatedPacks, changed } = sanitizeUserPackStore(parsed)
    if (isolatedPacks.length > 0) appendIsolated(isolatedPacksPath(), isolatedPacks)
    if (changed) saveUserRulePackState(state)
    return state
  } catch {
    return { schemaVersion: RULE_PACK_SCHEMA_VERSION, disabledPackIds: [], packs: [] }
  }
}

export function saveUserRulePackState(state: UserRulePackState): void {
  const { state: sanitized } = sanitizeUserPackStore(state)
  writeJsonAtomic(userPackStorePath(), sanitized)
}

export function listRuleDrafts(): StoredRuleDraft[] {
  return loadDraftStore().drafts
}

export function getRuleDraft(draftId: string): StoredRuleDraft | undefined {
  return loadDraftStore().drafts.find((draft) => draft.id === draftId)
}

export function saveRuleDraftRecord(record: StoredRuleDraft): StoredRuleDraft {
  const sanitized = sanitizeDraftStore({ schemaVersion: RULE_DRAFT_SCHEMA_VERSION, drafts: [record] })
  const valid = sanitized.state.drafts[0]
  if (!valid) throw new Error('草稿校验失败')

  const store = loadDraftStore()
  const index = store.drafts.findIndex((draft) => draft.id === valid.id)
  if (index >= 0) store.drafts[index] = valid
  else store.drafts.unshift(valid)
  saveDraftStore(store)
  return valid
}

export function createRuleDraftRecord(
  draft: RuleDraftV1,
  origin: RuleDraftOrigin,
  options: {
    sessionId?: string
    sessionFingerprint?: string
    candidateIds?: string[]
    status?: RuleDraftStatus
  } = {}
): StoredRuleDraft {
  const validated = validateRuleDraftInput(draft)
  const now = new Date().toISOString()
  const record: StoredRuleDraft = {
    id: `draft-${randomUUID()}`,
    draft: validated,
    status: options.status ?? 'validated',
    origin,
    sessionId: options.sessionId,
    sessionFingerprint: options.sessionFingerprint,
    candidateIds: options.candidateIds,
    createdAt: now,
    updatedAt: now
  }
  return saveRuleDraftRecord(record)
}

export function importRuleDraftJson(
  input: unknown,
  origin: RuleDraftOrigin = 'user-import',
  rawJson?: string
): StoredRuleDraft {
  if (rawJson !== undefined) {
    assertImportJsonSize(rawJson, RULE_DRAFT_LIMITS.MAX_DRAFT_JSON_BYTES)
  }
  const draft = validateRuleDraftInput(input)
  return createRuleDraftRecord({ ...draft, source: origin }, origin, { status: 'validated' })
}

export function updateRuleDraftStatus(
  draftId: string,
  status: RuleDraftStatus,
  patch: Partial<StoredRuleDraft> = {}
): StoredRuleDraft | null {
  const store = loadDraftStore()
  const index = store.drafts.findIndex((draft) => draft.id === draftId)
  if (index < 0) return null
  const next: StoredRuleDraft = {
    ...store.drafts[index],
    ...patch,
    status,
    updatedAt: new Date().toISOString()
  }
  const sanitized = sanitizeDraftStore({
    schemaVersion: RULE_DRAFT_SCHEMA_VERSION,
    drafts: [next]
  }).state.drafts[0]
  if (!sanitized) return null
  store.drafts[index] = sanitized
  saveDraftStore(store)
  return sanitized
}

export function deleteRuleDraft(draftId: string): boolean {
  const store = loadDraftStore()
  const before = store.drafts.length
  store.drafts = store.drafts.filter((draft) => draft.id !== draftId)
  if (store.drafts.length === before) return false
  saveDraftStore(store)
  return true
}

export function markDraftMigrationCompleted(): void {
  const store = loadDraftStore()
  store.migrationCompleted = true
  saveDraftStore(store)
}

export function isDraftMigrationCompleted(): boolean {
  return loadDraftStore().migrationCompleted === true
}
