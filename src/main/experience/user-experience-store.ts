import { app } from 'electron'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { UserExperienceStoreState } from '../../shared/user-experience-types'
import { USER_EXPERIENCE_SCHEMA_VERSION } from '../../shared/user-experience-types'
import { USER_EXPERIENCE_LIMITS } from '../../shared/user-experience-limits'
import {
  assertUserExperienceJsonSize,
  isValidUserExperienceStoreRoot,
  sanitizeUserExperienceStore
} from './user-experience-sanitizer'

let storeDirOverride: string | null = null
let readMainStoreFileCallCount = 0

type StoreIoOverrides = {
  renameSync?: (tempPath: string, finalPath: string) => void
  writeIsolatedFile?: (path: string, content: string) => void
}

let storeIoOverrides: StoreIoOverrides = {}

export function __setUserExperienceStoreDirForTests(dir: string | null): void {
  storeDirOverride = dir
}

export function __resetUserExperienceStoreTestState(): void {
  readMainStoreFileCallCount = 0
  storeIoOverrides = {}
}

export function __getReadMainStoreFileCallCountForTests(): number {
  return readMainStoreFileCallCount
}

export function __setUserExperienceStoreIoOverridesForTests(overrides: StoreIoOverrides | null): void {
  storeIoOverrides = overrides ?? {}
}

function getStoreDir(): string {
  if (storeDirOverride) return storeDirOverride
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

function logPersistenceWarning(message: string, error?: unknown): void {
  console.warn(`[user-experience] ${message}`, error)
}

function logContentCorruption(message: string, detail?: unknown): void {
  console.warn(`[user-experience] corrupt store: ${message}`, detail)
}

function cleanupStaleTempFiles(): void {
  const dir = getStoreDir()
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name.startsWith('user-experience.json.') && name.endsWith('.tmp')) {
      try {
        unlinkSync(join(dir, name))
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2)
  assertUserExperienceJsonSize(json)
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, json, 'utf-8')
    if (storeIoOverrides.renameSync) {
      storeIoOverrides.renameSync(temp, path)
    } else {
      renameSync(temp, path)
    }
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      // ignore cleanup failures
    }
    throw error
  }
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

function createCorruptBackup(path: string, fileSize: number, rawContent?: string): boolean {
  const dir = getStoreDir()
  const stamp = Date.now()
  const backupPath = join(dir, `user-experience-corrupt-${stamp}.json`)
  try {
    if (rawContent !== undefined) {
      const bytes = Buffer.from(rawContent, 'utf-8').subarray(0, USER_EXPERIENCE_LIMITS.MAX_ISOLATED_JSON_BYTES)
      writeFileSync(backupPath, bytes)
    } else {
      const fd = openSync(path, 'r')
      try {
        const toRead = Math.min(fileSize, USER_EXPERIENCE_LIMITS.MAX_ISOLATED_JSON_BYTES)
        const buffer = Buffer.alloc(toRead)
        readSync(fd, buffer, 0, toRead, 0)
        writeFileSync(backupPath, buffer)
      } finally {
        closeSync(fd)
      }
    }
    pruneCorruptBackups(dir)
    return true
  } catch {
    return false
  }
}

function handleCorruptMainStore(path: string, fileSize: number, rawContent?: string): UserExperienceStoreState {
  const backupCreated = createCorruptBackup(path, fileSize, rawContent)
  if (!backupCreated) {
    logPersistenceWarning('corrupt store backup failed; preserving main file')
    return emptyStore()
  }

  try {
    if (existsSync(path)) unlinkSync(path)
  } catch (error) {
    logPersistenceWarning('failed to remove corrupt main file after backup', error)
    return emptyStore()
  }

  try {
    writeJsonAtomic(storePath(), emptyStore())
  } catch (error) {
    logPersistenceWarning('failed to create fresh store after corruption; backup retained', error)
  }

  return emptyStore()
}

function appendIsolated(entries: unknown[]): void {
  if (entries.length === 0) return
  const path = isolatedPath()
  let existing: unknown[] = []
  if (existsSync(path)) {
    const stat = statSync(path)
    if (stat.size <= USER_EXPERIENCE_LIMITS.MAX_ISOLATED_JSON_BYTES) {
      try {
        const raw = readFileSync(path, 'utf-8')
        assertUserExperienceJsonSize(raw)
        const parsed = JSON.parse(raw) as { entries?: unknown[] }
        existing = Array.isArray(parsed.entries) ? parsed.entries : []
      } catch {
        existing = []
      }
    }
  }
  const next = {
    updatedAt: new Date().toISOString(),
    entries: [...entries, ...existing].slice(0, USER_EXPERIENCE_LIMITS.MAX_ISOLATED_ENTRIES)
  }
  const json = JSON.stringify(next, null, 2)
  if (Buffer.byteLength(json, 'utf-8') <= USER_EXPERIENCE_LIMITS.MAX_ISOLATED_JSON_BYTES) {
    if (storeIoOverrides.writeIsolatedFile) {
      storeIoOverrides.writeIsolatedFile(path, json)
    } else {
      writeFileSync(path, json, 'utf-8')
    }
  }
}

function emptyStore(): UserExperienceStoreState {
  return { schemaVersion: USER_EXPERIENCE_SCHEMA_VERSION, entries: [] }
}

function persistSanitizedStore(state: UserExperienceStoreState): void {
  if (state.entries.length > USER_EXPERIENCE_LIMITS.MAX_ENTRIES) {
    throw new Error('经验条目已达上限')
  }
  writeJsonAtomic(storePath(), state)
}

export function loadUserExperienceStore(): UserExperienceStoreState {
  cleanupStaleTempFiles()
  const path = storePath()
  if (!existsSync(path)) {
    return emptyStore()
  }

  let fileSize = 0
  try {
    fileSize = statSync(path).size
  } catch (error) {
    logPersistenceWarning('cannot stat experience store', error)
    return emptyStore()
  }

  if (fileSize > USER_EXPERIENCE_LIMITS.MAX_JSON_BYTES) {
    logContentCorruption('file exceeds size limit', fileSize)
    return handleCorruptMainStore(path, fileSize)
  }

  let raw = ''
  try {
    readMainStoreFileCallCount += 1
    raw = readFileSync(path, 'utf-8')
  } catch (error) {
    logPersistenceWarning('cannot read experience store', error)
    return emptyStore()
  }

  try {
    assertUserExperienceJsonSize(raw)
  } catch (error) {
    logContentCorruption('json byte size exceeds limit after read', error)
    return handleCorruptMainStore(path, fileSize, raw)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    logContentCorruption('json parse failed', error)
    return handleCorruptMainStore(path, fileSize, raw)
  }

  if (!isValidUserExperienceStoreRoot(parsed)) {
    logContentCorruption('root structure invalid')
    return handleCorruptMainStore(path, fileSize, raw)
  }

  const { state, isolated, changed } = sanitizeUserExperienceStore(parsed)

  if (isolated.length > 0) {
    try {
      appendIsolated(isolated)
    } catch (error) {
      logPersistenceWarning('failed to append isolated experience entries', error)
    }
  }

  if (changed) {
    try {
      persistSanitizedStore(state)
    } catch (error) {
      logPersistenceWarning('failed to write sanitized experience store', error)
    }
  }

  return state
}

export function saveUserExperienceStore(state: UserExperienceStoreState): void {
  cleanupStaleTempFiles()
  const { state: sanitized, isolated } = sanitizeUserExperienceStore(state)
  if (isolated.length > 0) {
    try {
      appendIsolated(isolated)
    } catch (error) {
      logPersistenceWarning('failed to append isolated entries during save', error)
    }
  }
  if (sanitized.entries.length > USER_EXPERIENCE_LIMITS.MAX_ENTRIES) {
    throw new Error('经验条目已达上限')
  }
  writeJsonAtomic(storePath(), sanitized)
}
