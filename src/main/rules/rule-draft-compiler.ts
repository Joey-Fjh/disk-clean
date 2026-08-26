import type { RuleConfig } from '../../shared/types'
import type { RuleDraftV1 } from '../../shared/rule-layer-types'
import { assertDraftScopePrecision } from './rule-draft-scope'
import { RuleDraftValidationError } from './rule-draft-validator'

function resolveCategory(draft: RuleDraftV1): RuleConfig['category'] {
  if (draft.contentType === 'user-data' || draft.contentType === 'system-protected') {
    return 'dangerous'
  }
  if (draft.suggestedRisk === 'safe') return 'recommended'
  return draft.suggestedRisk
}

function resolveDeletable(draft: RuleDraftV1): boolean {
  if (draft.rebuildable !== true) return false
  if (draft.contentType === 'user-data' || draft.contentType === 'system-protected') return false
  if (draft.suggestedRisk === 'dangerous') return false
  return true
}

export function compileRuleDraftToRuleConfig(draft: RuleDraftV1, draftId: string): RuleConfig {
  try {
    assertDraftScopePrecision(draft)
  } catch (error) {
    if (error instanceof RuleDraftValidationError) throw error
    throw new RuleDraftValidationError('规则范围无效')
  }

  return {
    id: `draft:${draftId}`,
    name: draft.name,
    category: resolveCategory(draft),
    contentType: draft.contentType,
    paths: [...draft.basePlaceholders],
    patterns: draft.relativePatterns ? [...draft.relativePatterns] : undefined,
    subdirs: draft.subdirs ? [...draft.subdirs] : undefined,
    globDirs: draft.globDirs ? [...draft.globDirs] : undefined,
    maxDepth: draft.maxDepth,
    maxAgeDays: draft.maxAgeDays,
    defaultChecked: false,
    description: draft.reason,
    reason: draft.reason,
    impact: draft.impact,
    rebuildable: draft.rebuildable,
    cleanupStrategy: 'trash',
    deletable: resolveDeletable(draft),
    nativeManaged: false
  }
}
