import { basename, resolve } from 'path'
import fg from 'fast-glob'
import type { RuleConfig } from './types'
import { expandEnvVars, isPathUnderRoot, normalizePath } from './path-utils'

export interface CandidateMatchMeta {
  parentTarget?: string
}

export function isObviousPathEscape(input: string): boolean {
  const normalized = input.replace(/\//g, '\\')
  const segments = normalized.split('\\')
  return segments.some((seg) => seg === '..')
}

export function isAbsoluteWindowsPath(path: string): boolean {
  const p = path.trim()
  return /^[A-Za-z]:\\/.test(p) || p.startsWith('\\\\')
}

/** subdirs / globDirs / patterns 必须是相对片段 */
export function isRelativeRuleSegment(segment: string): boolean {
  const s = segment.trim().replace(/\//g, '\\')
  if (!s) return false
  if (isObviousPathEscape(s)) return false
  if (/^[A-Za-z]:[\\/]/.test(s)) return false
  if (s.startsWith('\\\\')) return false
  if (s.startsWith('\\')) return false
  return true
}

export function resolveContainedUnderBase(basePath: string, segment: string): string | null {
  if (!isRelativeRuleSegment(segment)) return null
  const base = normalizePath(basePath)
  const resolved = normalizePath(resolve(basePath, segment))
  if (!isPathUnderRoot(resolved, base)) return null
  return resolved
}

function isTargetUnderBase(target: string, basePath: string): boolean {
  const base = normalizePath(basePath)
  const normalized = normalizePath(target)
  return normalized === base || isPathUnderRoot(normalized, base)
}

/** 与扫描阶段一致的规则目标收集 */
export async function collectRuleTargets(rule: RuleConfig): Promise<string[]> {
  const targets: string[] = []

  for (const rawPath of rule.paths) {
    const basePath = expandEnvVars(rawPath)
    if (basePath.includes('%')) continue
    if (!isAbsoluteWindowsPath(basePath)) continue

    if (rule.globDirs?.length) {
      for (const globDir of rule.globDirs) {
        if (!isRelativeRuleSegment(globDir)) continue
        const pattern = resolve(basePath, globDir).replace(/\\/g, '/')
        if (!isTargetUnderBase(pattern.replace(/\//g, '\\'), basePath)) continue
        try {
          const matches = await fg(pattern, {
            onlyDirectories: true,
            absolute: true,
            suppressErrors: true,
            dot: true,
            deep: rule.maxDepth ?? 6
          })
          targets.push(...matches.filter((m) => isTargetUnderBase(m, basePath)))
        } catch {
          // ignore
        }
      }
      continue
    }

    if (rule.subdirs?.length) {
      for (const sub of rule.subdirs) {
        const resolved = resolveContainedUnderBase(basePath, sub)
        if (resolved) targets.push(resolved)
      }
      continue
    }

    if (rule.patterns?.length) {
      if (rule.patterns.some((p) => !isRelativeRuleSegment(p))) continue
      const pattern = resolve(
        basePath,
        rule.patterns.length === 1 ? rule.patterns[0] : `**/{${rule.patterns.join(',')}}`
      )
      if (!isTargetUnderBase(pattern, basePath)) continue
      try {
        const matches = await fg(pattern.replace(/\\/g, '/'), {
          onlyFiles: true,
          absolute: true,
          suppressErrors: true,
          dot: true
        })
        targets.push(...matches.filter((m) => isTargetUnderBase(m, basePath)))
      } catch {
        // ignore
      }
      continue
    }

    targets.push(basePath)
  }

  return [...new Set(targets)]
}

function matchesFilePattern(fileName: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    'i'
  )
  return regex.test(fileName)
}

function fileMatchesRulePatterns(filePath: string, rule: RuleConfig): boolean {
  if (!rule.patterns?.length) return true
  const fileName = basename(filePath)
  return rule.patterns.some((pattern) => matchesFilePattern(fileName, pattern))
}

/** 精确授权：路径必须等于规则目标，或是在已记录规则根下的后代且仍在规则范围内。 */
export async function isPathAuthorizedByRule(
  filePath: string,
  rule: RuleConfig,
  meta?: CandidateMatchMeta
): Promise<boolean> {
  const normalizedFile = normalizePath(filePath)
  const targets = await collectRuleTargets(rule)

  if (meta?.parentTarget) {
    const anchor = normalizePath(meta.parentTarget)
    const authorizedAnchor = targets.some((target) => normalizePath(target) === anchor)
    if (!authorizedAnchor) return false
    if (!isPathUnderRoot(normalizedFile, anchor)) return false
    return fileMatchesRulePatterns(filePath, rule)
  }

  return targets.some((target) => normalizePath(target) === normalizedFile)
}

export function isOverlyBroadPath(expandedPath: string): boolean {
  const p = normalizePath(expandedPath)
  const blocked = [
    normalizePath('C:\\'),
    normalizePath('%SystemDrive%\\'),
    normalizePath('C:\\Windows'),
    normalizePath('C:\\Program Files'),
    normalizePath('C:\\Program Files (x86)'),
    normalizePath('%USERPROFILE%'),
    normalizePath('%LOCALAPPDATA%'),
    normalizePath('%APPDATA%')
  ].map((x) => expandEnvVars(x))

  return blocked.some((b) => p === b)
}
