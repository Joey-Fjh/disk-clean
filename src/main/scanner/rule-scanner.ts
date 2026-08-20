import { join } from 'path'
import { readdir, stat, lstat } from 'fs/promises'
import fg from 'fast-glob'
import type { Category, ContentType, RuleConfig, ScanItem, ScanError, ScanProgress } from '../../shared/types'
import { expandEnvVars, isProtectedPath } from '../../shared/path-utils'
import { getActiveRules, getProtectedPaths } from '../rules'

type ProgressCallback = (progress: ScanProgress) => void

export async function getPathSize(targetPath: string, depth = 0): Promise<number> {
  if (depth > 32) return 0

  try {
    const info = await lstat(targetPath)
    if (info.isSymbolicLink()) return 0
    if (info.isFile()) return info.size
    if (!info.isDirectory()) return 0

    let total = 0
    const entries = await readdir(targetPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue

      const child = join(targetPath, entry.name)
      try {
        if (entry.isDirectory()) {
          total += await getPathSize(child, depth + 1)
        } else if (entry.isFile()) {
          const fileStat = await stat(child)
          total += fileStat.size
        }
      } catch {
        // skip inaccessible children
      }
    }
    return total
  } catch {
    return 0
  }
}

function isOlderThan(maxAgeDays: number, mtimeMs: number): boolean {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  return mtimeMs < cutoff
}

async function collectTargets(rule: RuleConfig): Promise<string[]> {
  const targets: string[] = []

  for (const rawPath of rule.paths) {
    const basePath = expandEnvVars(rawPath)

    if (rule.globDirs?.length) {
      for (const globDir of rule.globDirs) {
        const pattern = join(basePath, globDir).replace(/\\/g, '/')
        try {
          const matches = await fg(pattern, {
            onlyDirectories: true,
            absolute: true,
            suppressErrors: true,
            dot: true,
            deep: rule.maxDepth ?? 6
          })
          targets.push(...matches)
        } catch {
          // path may not exist
        }
      }
      continue
    }

    if (rule.subdirs?.length) {
      for (const sub of rule.subdirs) {
        targets.push(join(basePath, sub))
      }
      continue
    }

    if (rule.patterns?.length) {
      const pattern = join(
        basePath,
        rule.patterns.length === 1 ? rule.patterns[0] : `**/{${rule.patterns.join(',')}}`
      )
      try {
        const matches = await fg(pattern.replace(/\\/g, '/'), {
          onlyFiles: true,
          absolute: true,
          suppressErrors: true,
          dot: true
        })
        targets.push(...matches)
      } catch {
        // path may not exist
      }
      continue
    }

    targets.push(basePath)
  }

  return [...new Set(targets)]
}

function resolveContentType(rule: RuleConfig): ContentType {
  return rule.contentType ?? 'app-cache'
}

function resolveDeletable(rule: RuleConfig, targetPath: string, protectedPaths: string[]): boolean {
  if (rule.deletable === false || rule.category === 'dangerous') return false
  if (isProtectedPath(targetPath, protectedPaths)) return false
  return true
}

function toScanItem(rule: RuleConfig, targetPath: string, size: number, protectedPaths: string[]): ScanItem {
  return {
    id: `${rule.id}:${targetPath}`,
    ruleId: rule.id,
    ruleName: rule.name,
    category: rule.category,
    contentType: resolveContentType(rule),
    path: targetPath,
    size,
    deletable: resolveDeletable(rule, targetPath, protectedPaths),
    source: 'rule',
    description: rule.description,
    reason: rule.reason ?? rule.description,
    impact: rule.impact,
    rebuildable: rule.rebuildable
  }
}

async function scanRule(
  rule: RuleConfig,
  protectedPaths: string[],
  errors: ScanError[]
): Promise<ScanItem[]> {
  const items: ScanItem[] = []
  const targets = await collectTargets(rule)

  for (const targetPath of targets) {
    try {
      const info = await lstat(targetPath).catch(() => null)
      if (!info || info.isSymbolicLink()) continue

      if (rule.maxAgeDays && info.isFile()) {
        if (!isOlderThan(rule.maxAgeDays, info.mtimeMs)) continue
      }

      const size = await getPathSize(targetPath)
      if (size === 0) continue

      items.push(toScanItem(rule, targetPath, size, protectedPaths))
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

function countByCategory(rules: RuleConfig[]): Record<Category, number> {
  return {
    safe: rules.filter((r) => r.category === 'safe').length,
    recommended: rules.filter((r) => r.category === 'recommended').length,
    dangerous: rules.filter((r) => r.category === 'dangerous').length
  }
}

export async function runRuleScan(onProgress?: ProgressCallback): Promise<{
  items: ScanItem[]
  errors: ScanError[]
}> {
  const rules = getActiveRules()
  const protectedPaths = getProtectedPaths()
  const errors: ScanError[] = []
  const items: ScanItem[] = []
  const categoryTotals = countByCategory(rules)
  const categorySeen: Record<Category, number> = { safe: 0, recommended: 0, dangerous: 0 }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    categorySeen[rule.category]++

    onProgress?.({
      mode: 'quick',
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

    const ruleItems = await scanRule(rule, protectedPaths, errors)
    items.push(...ruleItems)

    onProgress?.({
      mode: 'quick',
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

  return { items, errors }
}
