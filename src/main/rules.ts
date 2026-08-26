import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { RuleConfig, RuleWithMeta, UserRulesState } from '../shared/types'
import { loadRulesBundle, clearRulesCache } from './rules/rule-loader'
import { validateRuleInput } from './rules/rule-validator'
import { deleteRuleDraft } from './rules/rule-draft-store'
import {
  getLayeredActiveRules,
  getLayeredRulesWithMeta,
  importRuleDraftFromJson,
  resetRuleLayerUserState
} from './rules/rule-layer-service'

export { loadRulesBundle, clearRulesCache }

function getUserStatePath(): string {
  const dir = join(app.getPath('userData'), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'user-rules.json')
}

export function getAllRulesWithMeta(): RuleWithMeta[] {
  const state = loadUserState()
  return getLayeredRulesWithMeta().map((rule) => ({
    ...rule,
    enabled: rule.enabled && !state.disabledRuleIds.includes(rule.id)
  }))
}

export function loadUserState(): UserRulesState {
  const path = getUserStatePath()
  if (!existsSync(path)) {
    return { disabledRuleIds: [], customRules: [] }
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as UserRulesState
  } catch {
    return { disabledRuleIds: [], customRules: [] }
  }
}

export function saveUserState(state: UserRulesState): void {
  writeFileSync(getUserStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

export function getActiveRules(): RuleConfig[] {
  const state = loadUserState()
  return getLayeredActiveRules().filter((rule) => !state.disabledRuleIds.includes(rule.id))
}

export function getActiveRulesWithMeta(): RuleWithMeta[] {
  return getAllRulesWithMeta().filter((rule) => rule.enabled)
}

export function setRuleEnabled(ruleId: string, enabled: boolean): void {
  const state = loadUserState()
  if (enabled) {
    state.disabledRuleIds = state.disabledRuleIds.filter((id) => id !== ruleId)
  } else if (!state.disabledRuleIds.includes(ruleId)) {
    state.disabledRuleIds.push(ruleId)
  }
  saveUserState(state)
}

export function removeCustomRule(ruleId: string): boolean {
  if (!ruleId.startsWith('draft:')) return false
  return deleteRuleDraft(ruleId.replace(/^draft:/, ''))
}

export function importCustomRules(rules: unknown[]): number {
  let imported = 0
  for (const raw of rules) {
    try {
      importRuleDraftFromJson(raw)
      imported++
    } catch {
      const rule = validateRuleInput(raw, { builtinIds: [] })
      if (!rule) continue
      importRuleDraftFromJson({
        schemaVersion: '1',
        name: rule.name,
        contentType: rule.contentType ?? 'app-cache',
        basePlaceholders: rule.paths,
        relativePatterns: rule.patterns,
        subdirs: rule.subdirs,
        globDirs: rule.globDirs,
        maxDepth: rule.maxDepth,
        maxAgeDays: rule.maxAgeDays,
        reason: rule.reason ?? rule.description ?? rule.name,
        impact: rule.impact,
        rebuildable: rule.rebuildable,
        suggestedRisk: rule.category,
        source: 'user-import',
        createdAt: new Date().toISOString()
      })
      imported++
    }
  }
  return imported
}

export function resetUserRules(): void {
  saveUserState({ disabledRuleIds: [], customRules: [] })
  resetRuleLayerUserState()
}

export function getRuleById(ruleId: string): RuleConfig | undefined {
  const found = getAllRulesWithMeta().find((rule) => rule.id === ruleId)
  if (!found) return undefined
  const { enabled: _enabled, source: _source, ...rule } = found
  return rule
}

export function getProtectedPaths(): string[] {
  return loadRulesBundle().protectedPaths
}

export function getProtectedLabels(): Record<string, string> {
  return loadRulesBundle().protectedLabels
}

/** @deprecated 使用 getProtectedPaths */
export function getBlacklist(): string[] {
  return getProtectedPaths()
}

export { expandEnvVars, isProtectedPath, isBlacklisted, isPathUnderRoot, normalizePath } from '../shared/path-utils'
