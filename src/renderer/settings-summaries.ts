import type { ProviderProfilePublic, ProviderProfilesPublicState } from '../shared/provider-types'
import { getActiveProfile } from '../shared/provider-profile-utils'
import type { RuleWithMeta } from '../shared/types'

export type ThemeMode = 'light' | 'dark' | 'system'

export const THEME_SUMMARY_LABELS: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统'
}

export function formatThemeSummary(mode: ThemeMode): string {
  return THEME_SUMMARY_LABELS[mode]
}

export function formatProviderSummary(state: ProviderProfilesPublicState | null): string {
  const active = getActiveProfile(state)
  if (!active?.hasKey) return '未配置'
  return `${active.name} · ****${active.keyLastFour ?? '????'}`
}

export function formatRulesSummary(rules: RuleWithMeta[]): string {
  const enabled = rules.filter((rule) => rule.enabled).length
  return `已启用 ${enabled}/${rules.length}`
}

export type RulesCategoryFilter = 'all' | 'safe' | 'recommended' | 'dangerous'

export const RULES_CATEGORY_TABS: Array<{ id: RulesCategoryFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'safe', label: '建议清理' },
  { id: 'recommended', label: '谨慎处理' },
  { id: 'dangerous', label: '仅展示' }
]

export function isRulesCategoryFilter(value: string): value is RulesCategoryFilter {
  return value === 'all' || value === 'safe' || value === 'recommended' || value === 'dangerous'
}

export function filterRulesByCategory(
  rules: RuleWithMeta[],
  filter: RulesCategoryFilter
): RuleWithMeta[] {
  return rules.filter((rule) => filter === 'all' || rule.category === filter)
}
