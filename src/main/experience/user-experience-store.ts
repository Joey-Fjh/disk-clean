import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { UserExperienceStoreState } from '../../shared/user-experience-types'
import { USER_EXPERIENCE_SCHEMA_VERSION } from '../../shared/user-experience-types'
import { USER_EXPERIENCE_LIMITS } from '../../shared/user-experience-limits'
import { assertUserExperienceJsonSize, sanitizeUserExperienceStore } from './user-experience-sanitizer'

function getStoreDir(): string {
  const dir = join(app.getPath('userData'), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function storePath(): string {
  return join(getStoreDir(), 'user-experience.json')
}

function isolatedPath(): string {
  return join(getStoreDir(), 'user-experience-isolated.json')
}

function writeJsonAtomic(path: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2)
  assertUserExperienceJsonSize(json)
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, json, 'utf-8')
  renameSync(temp, path)
}

function pruneCorruptBackups(dir: string): void {
  const backups = readdirSync(dir)
    .filter((name) => name.startsWith('user-experience-corrupt-') && name.endsWith('.json'))
    .sort()
    .reverse()
  for (const name of backups.slice(USER_EXPERIENCE_LIMITS.MAX_CORRUPT_BACKUPS)) {
    try {
      unlinkSync(join(dir, name))
    } catch {
      // ignore cleanup failures
    }
  }
}

function isolateCorruptStore(originalPath: string, raw: string): void {
  const dir = getStoreDir()
  const stamp = Date.now()
  const backupPath = join(dir, `user-experience-corrupt-${stamp}.json`)
  const bytes = Buffer.from(raw, 'utf-8')
  const capped = bytes.subarray(0, USER_EXPERIENCE_LIMITS.MAX_ISOLATED_JSON_BYTES)
  writeFileSync(backupPath, capped)
  pruneCorruptBackups(dir)
  if (existsSync(originalPath)) {
    unlinkSync(originalPath)
  }
}

function appendIsolated(entries: unknown[]): void {
  if (entries.length === 0) return
  const path = isolatedPath()
  let existing: unknown[] = []
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf-8')
      assertUserExperienceJsonSize(raw)
      const parsed = JSON.parse(raw) as { entries?: unknown[] }
      existing = Array.isArray(parsed.entries) ? parsed.entries : []
    } catch {
      existing = []
    }
  }
  const next = {
    updatedAt: new Date().toISOString(),
    entries: [...entries, ...existing].slice(0, USER_EXPERIENCE_LIMITS.MAX_ISOLATED_ENTRIES)
  }
  const json = JSON.stringify(next, null, 2)
  if (Buffer.byteLength(json, 'utf-8') <= USER_EXPERIENCE_LIMITS.MAX_ISOLATED_JSON_BYTES) {
    writeFileSync(path, json, 'utf-8')
  }
}

function emptyStore(): UserExperienceStoreState {
  return { schemaVersion: USER_EXPERIENCE_SCHEMA_VERSION, entries: [] }
}

export function loadUserExperienceStore(): UserExperienceStoreState {
  const path = storePath()
  if (!existsSync(path)) {
    return emptyStore()
  }
  let raw = ''
  try {
    raw = readFileSync(path, 'utf-8')
    assertUserExperienceJsonSize(raw)
    const parsed = JSON.parse(raw) as unknown
    const { state, isolated, changed } = sanitizeUserExperienceStore(parsed)
    if (isolated.length > 0) appendIsolated(isolated)
    if (changed) saveUserExperienceStore(state)
    return state
  } catch (error) {
    if (raw) isolateCorruptStore(path, raw)
    const fresh = emptyStore()
    try {
      writeJsonAtomic(storePath(), fresh)
    } catch {
      // if write fails, still return empty in-memory store
    }
    console.warn('[user-experience] store load failed, isolated corrupt file:', error)
    return fresh
  }
}

export function saveUserExperienceStore(state: UserExperienceStoreState): void {
  const { state: sanitized, isolated, changed } = sanitizeUserExperienceStore(state)
  if (isolated.length > 0) appendIsolated(isolated)
  if (sanitized.entries.length > USER_EXPERIENCE_LIMITS.MAX_ENTRIES) {
    throw new Error('经验条目已达上限')
  }
  writeJsonAtomic(storePath(), sanitized)
  if (changed && isolated.length === 0) {
    // sanitized in place; already written
  }
}
