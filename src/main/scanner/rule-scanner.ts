import { join } from 'path'
import { readdir, lstat } from 'fs/promises'
import type { Category, ContentType, RuleWithMeta, ScanItem, ScanError, ScanProgress } from '../../shared/types'
import { mapRuleScanItem } from '../../shared/candidate-model'
import { shouldAutoSelect } from '../../shared/candidate-policy'
import { expandEnvVars, getDriveLetter, matchesDriveFilter } from '../../shared/path-utils'
import { collectRuleTargets } from '../../shared/rule-match'
import { getActiveRulesWithMeta, getProtectedPaths, getPathAccessPolicy } from '../rules'
import { enforceDraftRuleTargetLimit } from '../rules/rule-draft-scope'
import { isRuleOrdinaryDeletable } from '../../shared/rule-enforcement'
import { isPathOrdinaryDeleteForbidden } from '../../shared/path-access-policy'
import { isScanCancelled, yieldToEventLoop } from './scan-controller'
import { measurePathSizeDetailed } from './measure-size'

type ProgressCallback = (progress: ScanProgress) => void
type ItemsCallback = (items: ScanItem[]) => void

const MAX_CHILDREN_PER_DIR = 300
const MAX_AGE_RECURSE_DEPTH = 8

function isOlderThan(maxAgeDays: number, mtimeMs: number): boolean {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  return mtimeMs < cutoff
}

async function directoryContainsRecentFile(
  dirPath: string,
  maxAgeDays: number,
  depth: number
): Promise<boolean> {
  if (depth > MAX_AGE_RECURSE_DEPTH) return true
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (isScanCancelled()) break
      if (entry.isSymbolicLink()) continue
      const childPath = join(dirPath, entry.name)
      try {
        const childInfo = await lstat(childPath)
        if (childInfo.isSymbolicLink()) continue
        if (childInfo.isFile()) {
          if (!isOlderThan(maxAgeDays, childInfo.mtimeMs)) return true
          continue
        }
        if (await directoryContainsRecentFile(childPath, maxAgeDays, depth + 1)) {
          return true
        }
      } catch {
        // skip unreadable child
      }
    }
  } catch {
    return true
  }
  return false
}

function resolveContentType(rule: RuleWithMeta): ContentType {
  return rule.contentType ?? 'app-cache'
}

function resolveRecoveryMode(rule: RuleWithMeta): ScanItem['recoveryMode'] {
  if (rule.nativeManaged) return 'native-managed'
  return 'recycle-bin'
}

function resolveDeletable(rule: RuleWithMeta, targetPath: string, protectedPaths: string[]): boolean {
  if (!isRuleOrdinaryDeletable(rule)) return false
  if (isPathOrdinaryDeleteForbidden(targetPath, protectedPaths, getPathAccessPolicy())) return false
  return true
}

function toScanItem(
  rule: RuleWithMeta,
  targetPath: string,
  size: number,
  protectedPaths: string[],
  extra?: {
    parentTarget?: string
    mtimeMs?: number
    sizeIsEstimate?: boolean
    entryKind?: ScanItem['entryKind']
    snapshotComplete?: boolean
  }
): ScanItem {
  const snapshotComplete = extra?.snapshotComplete ?? true
  return mapRuleScanItem({
    id: `${rule.id}:${targetPath}`,
    ruleId: rule.id,
    ruleName: rule.name,
    category: rule.category,
    contentType: resolveContentType(rule),
    drive: getDriveLetter(targetPath),
    path: targetPath,
    size,
    sizeIsEstimate: extra?.sizeIsEstimate ?? true,
    snapshotComplete,
    entryKind: extra?.entryKind ?? 'directory',
    mtimeMs: extra?.mtimeMs,
    deletable: resolveDeletable(rule, targetPath, protectedPaths),
    autoSelect: shouldAutoSelect(rule, snapshotComplete),
    source: 'rule',
    ruleSource: rule.source,
    parentTarget: extra?.parentTarget,
    description: rule.description,
    reason: rule.reason ?? rule.description,
    impact: rule.impact,
    rebuildable: rule.rebuildable,
    requiresAppClosed: rule.requiresAppClosed,
    recoveryMode: resolveRecoveryMode(rule),
    discoverySources: ['rule'],
    evidence: [],
    judgment: {
      status: 'pending',
      source: 'none',
      confidence: 'unknown',
      basis: []
    },
    selection: { selectable: false },
    suggestedAction: 'none'
  })
}

function shouldListChildren(rule: RuleWithMeta): boolean {
  return rule.category !== 'dangerous' && rule.deletable !== false && !rule.nativeManaged
}

async function expandDirectoryChildren(
  rule: RuleWithMeta,
  dirPath: string,
  protectedPaths: string[],
  ruleRootTarget: string,
  depth = 0
): Promise<ScanItem[]> {
  if (depth >= MAX_AGE_RECURSE_DEPTH) return []
  const items: ScanItem[] = []

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    let listed = 0

    for (const entry of entries) {
      if (isScanCancelled()) break
      if (entry.isSymbolicLink()) continue

      const childPath = join(dirPath, entry.name)
      try {
        const childInfo = await lstat(childPath)
        if (childInfo.isSymbolicLink()) continue

        if (childInfo.isFile()) {
          if (rule.maxAgeDays && !isOlderThan(rule.maxAgeDays, childInfo.mtimeMs)) continue
          if (childInfo.size === 0) continue
          items.push(
            toScanItem(rule, childPath, childInfo.size, protectedPaths, {
              parentTarget: ruleRootTarget,
              mtimeMs: childInfo.mtimeMs,
              sizeIsEstimate: false,
              entryKind: 'file',
              snapshotComplete: true
            })
          )
          listed++
        } else if (rule.maxAgeDays) {
          const nested = await expandDirectoryChildren(
            rule,
            childPath,
            protectedPaths,
            ruleRootTarget,
            depth + 1
          )
          items.push(...nested)
          listed += nested.length
        } else {
          const measured = await measurePathSizeDetailed(childPath, rule)
          if (measured.size === 0) continue
          items.push(
            toScanItem(rule, childPath, measured.size, protectedPaths, {
              parentTarget: ruleRootTarget,
              mtimeMs: childInfo.mtimeMs,
              sizeIsEstimate: true,
              entryKind: 'directory',
              snapshotComplete: !measured.incomplete
            })
          )
          listed++
        }

        if (listed % 20 === 0) await yieldToEventLoop()
        if (listed >= MAX_CHILDREN_PER_DIR) break
      } catch {
        // skip
      }
    }
  } catch {
    // cannot read directory
  }

  return items
}

async function scanTarget(
  rule: RuleWithMeta,
  targetPath: string,
  protectedPaths: string[]
): Promise<ScanItem[]> {
  const info = await lstat(targetPath).catch(() => null)
  if (!info || info.isSymbolicLink()) return []

  if (info.isFile()) {
    if (rule.maxAgeDays && !isOlderThan(rule.maxAgeDays, info.mtimeMs)) return []
    return [
      toScanItem(rule, targetPath, info.size, protectedPaths, {
        mtimeMs: info.mtimeMs,
        sizeIsEstimate: false,
        entryKind: 'file',
        snapshotComplete: true
      })
    ]
  }

  if (!shouldListChildren(rule)) {
    const measured = await measurePathSizeDetailed(targetPath, rule)
    return [
      toScanItem(rule, targetPath, measured.size, protectedPaths, {
        mtimeMs: info.mtimeMs,
        sizeIsEstimate: true,
        entryKind: 'directory',
        snapshotComplete: !measured.incomplete
      })
    ]
  }

  const children = await expandDirectoryChildren(rule, targetPath, protectedPaths, targetPath)
  if (children.length > 0) return children

  if (rule.maxAgeDays) {
    const hasRecent = await directoryContainsRecentFile(targetPath, rule.maxAgeDays, 0)
    if (hasRecent) return []
  }

  const measured = await measurePathSizeDetailed(targetPath, rule)
  if (measured.size === 0) return []
  if (rule.maxAgeDays) return []
  return [
    toScanItem(rule, targetPath, measured.size, protectedPaths, {
      mtimeMs: info.mtimeMs,
      sizeIsEstimate: true,
      entryKind: 'directory',
      snapshotComplete: !measured.incomplete
    })
  ]
}

async function scanRule(
  rule: RuleWithMeta,
  driveFilter: string,
  protectedPaths: string[],
  errors: ScanError[]
): Promise<ScanItem[]> {
  const items: ScanItem[] = []
  const targets = await collectRuleTargets(rule)
  const limited = enforceDraftRuleTargetLimit(rule, targets.length)
  const effectiveRule = limited.rule
  if (limited.downgraded && limited.message) {
    errors.push({
      ruleId: rule.id,
      path: rule.paths.join(';'),
      message: limited.message
    })
  }

  for (const targetPath of targets) {
    if (isScanCancelled()) break
    if (!matchesDriveFilter(targetPath, driveFilter)) continue

    try {
      const targetItems = await scanTarget(effectiveRule, targetPath, protectedPaths)
      for (const item of targetItems) {
        if (!matchesDriveFilter(item.path, driveFilter)) continue
        items.push(item)
      }
    } catch (err) {
      errors.push({
        ruleId: rule.id,
        path: targetPath,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return items
}

function countByCategory(rules: RuleWithMeta[]): Record<Category, number> {
  return {
    safe: rules.filter((r) => r.category === 'safe').length,
    recommended: rules.filter((r) => r.category === 'recommended').length,
    dangerous: rules.filter((r) => r.category === 'dangerous').length
  }
}

export async function runRuleScan(
  driveFilter = 'all',
  onProgress?: ProgressCallback,
  onItems?: ItemsCallback,
  mode: ScanProgress['mode'] = 'quick'
): Promise<{
  items: ScanItem[]
  errors: ScanError[]
  cancelled: boolean
}> {
  const rules = getActiveRulesWithMeta()
  const protectedPaths = getProtectedPaths()
  const errors: ScanError[] = []
  const items: ScanItem[] = []
  const categoryTotals = countByCategory(rules)
  const categorySeen: Record<Category, number> = { safe: 0, recommended: 0, dangerous: 0 }

  for (let i = 0; i < rules.length; i++) {
    if (isScanCancelled()) break
    await yieldToEventLoop()

    const rule = rules[i]
    categorySeen[rule.category]++

    onProgress?.({
      mode,
      label: rule.name,
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      status: 'scanning',
      current: i + 1,
      total: rules.length,
      categoryCurrent: categorySeen[rule.category],
      categoryTotal: categoryTotals[rule.category]
    })

    const ruleItems = await scanRule(rule, driveFilter, protectedPaths, errors)
    items.push(...ruleItems)
    if (ruleItems.length > 0) onItems?.(ruleItems)

    onProgress?.({
      mode,
      label: rule.name,
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      status: 'done',
      current: i + 1,
      total: rules.length,
      categoryCurrent: categorySeen[rule.category],
      categoryTotal: categoryTotals[rule.category]
    })
  }

  return { items, errors, cancelled: isScanCancelled() }
}
