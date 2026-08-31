import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { UserExperienceStoreState } from '../../shared/user-experience-types'
import { USER_EXPERIENCE_SCHEMA_VERSION } from '../../shared/user-experience-types'
import { sanitizeUserExperienceStore } from './user-experience-sanitizer'

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
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf-8')
  renameSync(temp, path)
}

function appendIsolated(entries: unknown[]): void {
  if (entries.length === 0) return
  const path = isolatedPath()
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

export function loadUserExperienceStore(): UserExperienceStoreState {
  const path = storePath()
  if (!existsSync(path)) {
    return { schemaVersion: USER_EXPERIENCE_SCHEMA_VERSION, entries: [] }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const { state, isolated, changed } = sanitizeUserExperienceStore(parsed)
    if (isolated.length > 0) appendIsolated(isolated)
    if (changed) saveUserExperienceStore(state)
    return state
  } catch {
    return { schemaVersion: USER_EXPERIENCE_SCHEMA_VERSION, entries: [] }
  }
}

export function saveUserExperienceStore(state: UserExperienceStoreState): void {
  writeJsonAtomic(storePath(), state)
}
