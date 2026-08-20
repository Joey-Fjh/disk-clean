import { join, basename } from 'path'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import type { Category, ContentType, RuleConfig, ScanItem } from '../../shared/types'
import { expandEnvVars, isPathUnderRoot } from '../../shared/path-utils'
import { getActiveRules } from '../rules'

export interface MatchedRule {
  rule: RuleConfig
  confidence: 'exact' | 'prefix'
}

export function matchPathToRule(path: string, rules = getActiveRules()): MatchedRule | null {
  const normalized = path.replace(/\//g, '\\')

  for (const rule of rules) {
    for (const rawPath of rule.paths) {
      const basePath = expandEnvVars(rawPath)
      if (normalized === basePath || isPathUnderRoot(normalized, basePath)) {
        return { rule, confidence: normalized === basePath ? 'exact' : 'prefix' }
      }
    }
  }

  return null
}

export function enrichCandidate(
  path: string,
  size: number,
  fallback: {
    name: string
    contentType: ContentType
    category: Category
    deletable: boolean
    reason?: string
    impact?: string
  }
): ScanItem {
  const matched = matchPathToRule(path)

  if (matched) {
    const { rule } = matched
    return {
      id: `${rule.id}:${path}`,
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      contentType: rule.contentType ?? fallback.contentType,
      path,
      size,
      deletable: fallback.deletable && rule.deletable !== false && rule.category !== 'dangerous',
      source: 'analyzer',
      description: rule.description,
      reason: rule.reason ?? rule.description ?? fallback.reason,
      impact: rule.impact ?? fallback.impact,
      rebuildable: rule.rebuildable
    }
  }

  return {
    id: `analyzer:${path}`,
    ruleId: '__analyzer__',
    ruleName: fallback.name,
    category: fallback.category,
    contentType: fallback.contentType,
    path,
    size,
    deletable: fallback.deletable,
    source: 'analyzer',
    reason: fallback.reason,
    impact: fallback.impact
  }
}

export async function listImmediateChildren(dirPath: string): Promise<string[]> {
  if (!existsSync(dirPath)) return []

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .filter((entry) => !entry.isSymbolicLink() && entry.isDirectory())
      .map((entry) => join(dirPath, entry.name))
  } catch {
    return []
  }
}

export function displayNameForPath(path: string): string {
  return basename(path) || path
}
