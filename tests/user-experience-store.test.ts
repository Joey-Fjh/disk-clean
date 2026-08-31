import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\disk-clean-test-unused'
  }
}))

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { USER_EXPERIENCE_LIMITS } from '../src/shared/user-experience-limits'
import { USER_EXPERIENCE_SCHEMA_VERSION } from '../src/shared/user-experience-types'
import {
  __getReadMainStoreFileCallCountForTests,
  __resetUserExperienceStoreTestState,
  __setUserExperienceStoreDirForTests,
  __setUserExperienceStoreIoOverridesForTests,
  loadUserExperienceStore,
  saveUserExperienceStore
} from '../src/main/experience/user-experience-store'
import { sanitizeUserExperienceStore } from '../src/main/experience/user-experience-sanitizer'
import { createUserExperience } from '../src/main/experience/user-experience-service'
import { clearScanSession, createScanSession } from '../src/main/scan/scan-session-store'
import type { ScanCandidate } from '../src/shared/types'

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    kind: 'keep-exclusion',
    name: '保留项',
    enabled: true,
    matcher: { ruleId: 'rule-a', relativePathSuffix: 'Cache' },
    reason: '用户确认',
    source: 'user-confirmed',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function validStore(entries: unknown[] = [validEntry()]) {
  return {
    schemaVersion: USER_EXPERIENCE_SCHEMA_VERSION,
    entries
  }
}

function makeCandidate(id: string, path: string): ScanCandidate {
  return {
    id,
    ruleId: 'rule-a',
    ruleName: 'Temp Cache',
    category: 'safe',
    contentType: 'app-cache',
    drive: 'C:',
    path,
    size: 100,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    deletable: true,
    reason: 'cache',
    impact: 'low'
  }
}

describe('user experience store integrity', () => {
  let storeDir = ''

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'disk-clean-ux-store-'))
    __setUserExperienceStoreDirForTests(storeDir)
    __resetUserExperienceStoreTestState()
    clearScanSession()
  })

  afterEach(() => {
    __setUserExperienceStoreDirForTests(null)
    __resetUserExperienceStoreTestState()
    if (storeDir) rmSync(storeDir, { recursive: true, force: true })
    clearScanSession()
  })

  it('rejects oversized files before readFileSync loads them into memory', () => {
    const path = join(storeDir, 'user-experience.json')
    writeFileSync(path, 'x'.repeat(USER_EXPERIENCE_LIMITS.MAX_JSON_BYTES + 1024))

    const state = loadUserExperienceStore()

    expect(state.entries).toHaveLength(0)
    expect(__getReadMainStoreFileCallCountForTests()).toBe(0)
    expect(readdirSync(storeDir).some((name) => name.startsWith('user-experience-corrupt-'))).toBe(true)
  })

  it('preserves original main file when dirty writeback fails', () => {
    const path = join(storeDir, 'user-experience.json')
    const original = validStore([
      validEntry({
        name: '  padded name  '
      })
    ])
    writeFileSync(path, JSON.stringify(original, null, 2), 'utf-8')
    const originalContent = readFileSync(path, 'utf-8')
    __setUserExperienceStoreIoOverridesForTests({
      renameSync: () => {
        throw new Error('rename failed')
      }
    })

    const state = loadUserExperienceStore()

    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]?.name).toBe('padded name')
    expect(readFileSync(path, 'utf-8')).toBe(originalContent)
  })

  it('does not isolate main file when appendIsolated fails', () => {
    const path = join(storeDir, 'user-experience.json')
    writeFileSync(path, JSON.stringify(validStore([validEntry(), { id: 'bad' }]), null, 2), 'utf-8')
    const originalContent = readFileSync(path, 'utf-8')
    __setUserExperienceStoreIoOverridesForTests({
      writeIsolatedFile: () => {
        throw new Error('isolated write failed')
      }
    })

    const state = loadUserExperienceStore()

    expect(state.entries).toHaveLength(1)
    expect(readFileSync(path, 'utf-8')).toBe(originalContent)
    expect(readdirSync(storeDir).some((name) => name.startsWith('user-experience-corrupt-'))).toBe(false)
  })

  it('creates capped backup and clean store for corrupt json', () => {
    const path = join(storeDir, 'user-experience.json')
    writeFileSync(path, '{ not-json', 'utf-8')

    const state = loadUserExperienceStore()

    expect(state.entries).toHaveLength(0)
    const backup = readdirSync(storeDir).find((name) => name.startsWith('user-experience-corrupt-'))
    expect(backup).toBeTruthy()
    expect(statSync(join(storeDir, backup!)).size).toBeLessThanOrEqual(
      USER_EXPERIENCE_LIMITS.MAX_ISOLATED_JSON_BYTES
    )
    expect(JSON.parse(readFileSync(join(storeDir, 'user-experience.json'), 'utf-8'))).toEqual({
      schemaVersion: USER_EXPERIENCE_SCHEMA_VERSION,
      entries: []
    })
  })

  it('does not leave temp files when atomic write fails', () => {
    __setUserExperienceStoreIoOverridesForTests({
      renameSync: () => {
        throw new Error('rename failed')
      }
    })

    expect(() => saveUserExperienceStore(validStore())).toThrow('rename failed')
    expect(readdirSync(storeDir).some((name) => name.includes('.tmp'))).toBe(false)
  })
})

describe('user experience sanitizer dirty flags', () => {
  it('marks trim and truncation as changed', () => {
    const { changed, state } = sanitizeUserExperienceStore({
      schemaVersion: 1,
      entries: [
        validEntry({
          name: `  ${'n'.repeat(USER_EXPERIENCE_LIMITS.MAX_NAME_LENGTH + 5)}  `,
          matcher: {
            ruleId: ` ${'r'.repeat(90)} `
          }
        })
      ]
    })
    expect(changed).toBe(true)
    expect(state.entries[0]?.name.length).toBeLessThanOrEqual(USER_EXPERIENCE_LIMITS.MAX_NAME_LENGTH)
  })

  it('isolates non-boolean enabled values', () => {
    const { state, isolated, changed } = sanitizeUserExperienceStore({
      schemaVersion: 1,
      entries: [validEntry({ enabled: 'yes' })]
    })
    expect(state.entries).toHaveLength(0)
    expect(isolated).toHaveLength(1)
    expect(changed).toBe(true)
  })
})

describe('user experience service dedupe', () => {
  let storeDir = ''

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'disk-clean-ux-service-'))
    __setUserExperienceStoreDirForTests(storeDir)
    __resetUserExperienceStoreTestState()
    clearScanSession()
  })

  afterEach(() => {
    __setUserExperienceStoreDirForTests(null)
    __resetUserExperienceStoreTestState()
    if (storeDir) rmSync(storeDir, { recursive: true, force: true })
    clearScanSession()
  })

  it('re-enables disabled equivalent experience without increasing entry count', () => {
    saveUserExperienceStore(
      validStore([
        validEntry({
          id: 'keep-old',
          enabled: false,
          createdAt: 10,
          updatedAt: 10,
          matcher: {
            ruleId: 'rule-a',
            contentType: 'app-cache',
            relativePathSuffix: 'temp\\cache\\file',
            softwareName: 'Temp Cache'
          }
        })
      ])
    )

    const session = createScanSession('C:', 'quick', 'v1', [
      makeCandidate('cand-1', 'C:\\Temp\\Cache\\file')
    ])

    const updated = createUserExperience({
      sessionId: session.sessionId,
      candidateId: 'cand-1',
      kind: 'keep-exclusion',
      confirmed: true
    })

    const store = loadUserExperienceStore()
    expect(store.entries).toHaveLength(1)
    expect(updated.id).toBe('keep-old')
    expect(updated.enabled).toBe(true)
    expect(updated.createdAt).toBe(10)
    expect(updated.updatedAt).toBeGreaterThan(10)
  })
})
