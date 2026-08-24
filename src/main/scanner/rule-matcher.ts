import { join, basename } from 'path'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import type { Category, ContentType, EntryKind, RuleConfig, ScanItem } from '../../shared/types'
import { mapSpaceScanItem } from '../../shared/candidate-model'
import { getDriveLetter, expandEnvVars, isPathUnderRoot } from '../../shared/path-utils'
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
    entryKind?: EntryKind
    sizePartial?: boolean
  }
): ScanItem {
  const matched = matchPathToRule(path)
  const entryKind = fallback.entryKind ?? 'directory'

  if (matched) {
    const { rule } = matched
    return mapSpaceScanItem({
      id: `analyzer:${path}`,
      ruleId: '__analyzer__',
      ruleName: fallback.name,
      category: 'dangerous',
      contentType: rule.contentType ?? fallback.contentType,
      drive: getDriveLetter(path),
      path,
      size,
      sizeIsEstimate: true,
      sizePartial: fallback.sizePartial,
      snapshotComplete: fallback.sizePartial !== true,
      entryKind,
      deletable: false,
      autoSelect: false,
      source: 'analyzer',
      description: rule.description,
      reason: fallback.reason ?? rule.reason ?? rule.description,
      impact: fallback.impact ?? rule.impact,
      rebuildable: rule.rebuildable,
      recoveryMode: rule.nativeManaged ? 'native-managed' : 'none',
      discoverySources: ['space-scan'],
      evidence: [],
      judgment: { status: 'pending', source: 'none', confidence: 'unknown', basis: [] },
      selection: { selectable: false },
      suggestedAction: 'none'
    })
  }

  return mapSpaceScanItem({
    id: `analyzer:${path}`,
    ruleId: '__analyzer__',
    ruleName: fallback.name,
    category: fallback.category,
    contentType: fallback.contentType,
    drive: getDriveLetter(path),
    path,
    size,
    sizeIsEstimate: true,
    sizePartial: fallback.sizePartial,
    snapshotComplete: fallback.sizePartial !== true,
    entryKind,
    deletable: false,
    autoSelect: false,
    source: 'analyzer',
    reason: fallback.reason,
    impact: fallback.impact,
    recoveryMode: 'none',
    discoverySources: ['space-scan'],
    evidence: [],
    judgment: { status: 'pending', source: 'none', confidence: 'unknown', basis: [] },
    selection: { selectable: false },
    suggestedAction: 'none'
  })
}

export async function listDriveRootEntries(driveRoot: string): Promise<string[]> {
  if (!existsSync(driveRoot)) return []

  try {
    const entries = await readdir(driveRoot, { withFileTypes: true })
    return entries
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => join(driveRoot, entry.name))
  } catch {
    return []
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
