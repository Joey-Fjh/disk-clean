import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { RuleConfig, RuleWithMeta, UserRulesState } from '../shared/types'
import { loadRulesBundle, clearRulesCache } from './rules/rule-loader'
import { validateRuleInput } from './rules/rule-validator'

export { loadRulesBundle, clearRulesCache }

function getUserStatePath(): string {
  const dir = join(app.getPath('userData'), 'config')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'user-rules.json')
}

export function getAllRulesWithMeta(): RuleWithMeta[] {
  const { rules } = loadRulesBundle()
  const state = loadUserState()

  const builtin: RuleWithMeta[] = rules.map((rule) => ({
    ...rule,
    enabled: !state.disabledRuleIds.includes(rule.id),
    source: 'builtin'
  }))

  const custom: RuleWithMeta[] = state.customRules.map((rule) => ({
    ...rule,
    enabled: !state.disabledRuleIds.includes(rule.id),
    source: 'custom'
  }))

  return [...builtin, ...custom]
}

export function loadUserState(): UserRulesState {
  const path = getUserStatePath()
  if (!existsSync(path)) {
    return { disabledRuleIds: [], customRules: [] }
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as UserRulesState
}

export function saveUserState(state: UserRulesState): void {
  writeFileSync(getUserStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

export function getActiveRules(): RuleConfig[] {
  return getAllRulesWithMeta()
    .filter((rule) => rule.enabled)
    .map(({ enabled: _enabled, source: _source, ...rule }) => rule)
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
  const state = loadUserState()
  const before = state.customRules.length
  state.customRules = state.customRules.filter((rule) => rule.id !== ruleId)
  state.disabledRuleIds = state.disabledRuleIds.filter((id) => id !== ruleId)
  saveUserState(state)
  return state.customRules.length < before
}

export function importCustomRules(rules: unknown[]): number {
  const state = loadUserState()
  let imported = 0

  for (const raw of rules) {
    const rule = validateRuleInput(raw)
    if (!rule) continue

    const index = state.customRules.findIndex((item) => item.id === rule.id)
    if (index >= 0) {
      state.customRules[index] = rule
    } else {
      state.customRules.push(rule)
    }
    imported++
  }

  saveUserState(state)
  return imported
}

export function resetUserRules(): void {
  saveUserState({ disabledRuleIds: [], customRules: [] })
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
