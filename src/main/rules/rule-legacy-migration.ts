import type { RulePackManifest } from '../../shared/rule-layer-types'
import { RULE_PACK_SCHEMA_VERSION } from '../../shared/rule-layer-types'
import type { RuleConfig, UserRulesState } from '../../shared/types'
import { validateRuleInput } from './rule-validator'
import { loadUserRulePackState, saveUserRulePackState } from './rule-draft-store'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

function getUserStatePath(): string {
  const dir = join(app.getPath('userData'), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'user-rules.json')
}

function isolatedLegacyRulesPath(): string {
  const dir = join(app.getPath('userData'), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'legacy-isolated-rules.json')
}

function loadUserState(): UserRulesState {
  const path = getUserStatePath()
  if (!existsSync(path)) return { disabledRuleIds: [], customRules: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as UserRulesState
  } catch {
    return { disabledRuleIds: [], customRules: [] }
  }
}

function saveUserState(state: UserRulesState): void {
  writeFileSync(getUserStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

function saveIsolatedRules(entries: unknown[]): void {
  if (entries.length === 0) return
  writeFileSync(
    isolatedLegacyRulesPath(),
    JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, 2),
    'utf-8'
  )
}

const LEGACY_PACK_ID = 'legacy-user-pack'

export interface LegacyMigrationResult {
  migratedRules: number
  isolatedRules: number
  alreadyMigrated: boolean
}

function buildLegacyPack(rules: RuleConfig[]): RulePackManifest {
  return {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: LEGACY_PACK_ID,
    name: '旧版自定义规则',
    version: '1.0.0',
    origin: 'legacy-user',
    platform: 'windows',
    description: '从 user-rules.json 迁移的自定义规则',
    rules
  }
}

export function migrateLegacyUserRulesIfNeeded(): LegacyMigrationResult {
  const packState = loadUserRulePackState()
  const existing = packState.packs.find((pack) => pack.id === LEGACY_PACK_ID)
  if (existing) {
    return { migratedRules: existing.rules.length, isolatedRules: 0, alreadyMigrated: true }
  }

  const userState = loadUserState()
  if (userState.customRules.length === 0 && userState.disabledRuleIds.length === 0) {
    return { migratedRules: 0, isolatedRules: 0, alreadyMigrated: false }
  }

  const builtinIds: string[] = []
  const migrated: RuleConfig[] = []
  const isolated: unknown[] = []

  for (const raw of userState.customRules) {
    const rule = validateRuleInput(raw, { builtinIds })
    if (!rule) {
      isolated.push(raw)
      continue
    }
    migrated.push(rule)
    builtinIds.push(rule.id)
  }

  if (isolated.length > 0) {
    saveIsolatedRules(isolated)
  }

  if (migrated.length > 0) {
    packState.packs.push(buildLegacyPack(migrated))
    const allDisabled =
      migrated.length > 0 && migrated.every((rule) => userState.disabledRuleIds.includes(rule.id))
    if (allDisabled && !packState.disabledPackIds.includes(LEGACY_PACK_ID)) {
      packState.disabledPackIds.push(LEGACY_PACK_ID)
    }
    saveUserRulePackState(packState)
  }

  const nextUserState: UserRulesState = {
    disabledRuleIds: [...new Set(userState.disabledRuleIds)],
    customRules: []
  }
  saveUserState(nextUserState)

  return {
    migratedRules: migrated.length,
    isolatedRules: isolated.length,
    alreadyMigrated: false
  }
}

export function getLegacyPackId(): string {
  return LEGACY_PACK_ID
}
