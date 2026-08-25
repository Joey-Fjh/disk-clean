import { describe, expect, it } from 'vitest'
import {
  RULES_CATEGORY_TABS,
  filterRulesByCategory,
  formatProviderSummary,
  formatRulesSummary,
  formatThemeSummary,
  isRulesCategoryFilter
} from '../src/renderer/settings-summaries'
import type { ProviderConfigPublic } from '../src/shared/provider-types'
import type { RuleWithMeta } from '../src/shared/types'

describe('settings summaries', () => {
  it('formats theme summary labels', () => {
    expect(formatThemeSummary('light')).toBe('浅色')
    expect(formatThemeSummary('dark')).toBe('深色')
    expect(formatThemeSummary('system')).toBe('跟随系统')
  })

  it('formats provider summary for configured and unconfigured states', () => {
    expect(formatProviderSummary(null)).toBe('未配置')
    const config: ProviderConfigPublic = {
      providerId: 'openai',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      hasKey: true,
      keyLastFour: '4821'
    }
    expect(formatProviderSummary(config)).toBe('已配置 · ****4821')
  })

  it('formats rules summary with enabled count', () => {
    const rules = [
      { enabled: true },
      { enabled: false },
      { enabled: true }
    ] as RuleWithMeta[]
    expect(formatRulesSummary(rules)).toBe('已启用 2/3')
  })

  it('maps rules category tabs to valid filters', () => {
    expect(RULES_CATEGORY_TABS.map((tab) => tab.id)).toEqual([
      'all',
      'safe',
      'recommended',
      'dangerous'
    ])
    expect(isRulesCategoryFilter('safe')).toBe(true)
    expect(isRulesCategoryFilter('invalid')).toBe(false)
  })

  it('filters rules by category tab id', () => {
    const rules = [
      { id: 'a', category: 'safe', enabled: true },
      { id: 'b', category: 'recommended', enabled: true },
      { id: 'c', category: 'dangerous', enabled: false }
    ] as RuleWithMeta[]
    expect(filterRulesByCategory(rules, 'all')).toHaveLength(3)
    expect(filterRulesByCategory(rules, 'safe').map((r) => r.id)).toEqual(['a'])
    expect(filterRulesByCategory(rules, 'recommended').map((r) => r.id)).toEqual(['b'])
    expect(filterRulesByCategory(rules, 'dangerous').map((r) => r.id)).toEqual(['c'])
  })
})
