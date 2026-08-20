import { existsSync } from 'fs'
import { realpath } from 'fs/promises'
import { resolve } from 'path'
import fg from 'fast-glob'
import type { CleanupAction, RuleConfig } from '../../shared/types'
import { expandEnvVars, isBlacklisted, isPathUnderRoot, normalizePath } from '../../shared/path-utils'
import { getProtectedPaths, getAllRulesWithMeta } from '../rules'
import { isProtectedPath } from '../../shared/path-utils'

export interface ValidatedAction extends CleanupAction {
  resolvedPath: string
}

export interface ValidationResult {
  approved: ValidatedAction[]
  rejected: Array<{ path: string; reason: string }>
}

async function resolveSafePath(targetPath: string): Promise<string | null> {
  try {
    const absolute = resolve(expandEnvVars(targetPath))
    if (!existsSync(absolute)) return null
    return await realpath(absolute)
  } catch {
    return null
  }
}

async function collectRuleRoots(rule: RuleConfig): Promise<string[]> {
  const roots: string[] = []

  for (const rawPath of rule.paths) {
    const basePath = expandEnvVars(rawPath)
    roots.push(basePath)

    if (rule.subdirs?.length) {
      for (const sub of rule.subdirs) {
        roots.push(resolve(basePath, sub))
      }
    }

    if (rule.globDirs?.length) {
      for (const globDir of rule.globDirs) {
        const pattern = resolve(basePath, globDir).replace(/\\/g, '/')
        try {
          const matches = await fg(pattern, {
            onlyDirectories: true,
            absolute: true,
            suppressErrors: true,
            dot: true,
            deep: rule.maxDepth ?? 6
          })
          roots.push(...matches)
        } catch {
          // ignore
        }
      }
    }

    if (rule.patterns?.length) {
      const pattern = resolve(
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
        roots.push(...matches)
      } catch {
        // ignore
      }
    }
  }

  return [...new Set(roots)]
}

async function isWithinRuleScope(resolvedPath: string, rule: RuleConfig): Promise<boolean> {
  const roots = await collectRuleRoots(rule)
  return roots.some((root) => isPathUnderRoot(resolvedPath, root))
}

export async function validateCleanupActions(actions: CleanupAction[]): Promise<ValidationResult> {
  const protectedPaths = getProtectedPaths()
  const approved: ValidatedAction[] = []
  const rejected: Array<{ path: string; reason: string }> = []

  for (const action of actions) {
    const ruleMeta = getAllRulesWithMeta().find((item) => item.id === action.ruleId)
    if (!ruleMeta || !ruleMeta.enabled) {
      rejected.push({ path: action.target, reason: '规则未启用或不存在' })
      continue
    }

    const rule = ruleMeta

    if (rule.deletable === false || rule.category === 'dangerous') {
      rejected.push({ path: action.target, reason: '该规则项不允许删除' })
      continue
    }

    const resolvedPath = await resolveSafePath(action.target)
    if (!resolvedPath) {
      rejected.push({ path: action.target, reason: '路径不存在或无法访问' })
      continue
    }

    if (isProtectedPath(resolvedPath, protectedPaths)) {
      rejected.push({ path: action.target, reason: '路径在系统保护范围内' })
      continue
    }

    const normalizedInput = normalizePath(action.target)
    const normalizedResolved = normalizePath(resolvedPath)
    if (normalizedInput !== normalizedResolved && !isPathUnderRoot(normalizedResolved, normalizedInput)) {
      rejected.push({ path: action.target, reason: '路径解析后与原始路径不一致（可能为符号链接）' })
      continue
    }

    if (!(await isWithinRuleScope(resolvedPath, rule))) {
      rejected.push({ path: action.target, reason: '路径不在规则允许范围内' })
      continue
    }

    approved.push({ ...action, resolvedPath })
  }

  return { approved, rejected }
}
