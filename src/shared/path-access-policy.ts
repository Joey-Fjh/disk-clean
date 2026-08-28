/** 浏览器/renderer 安全的路径规范化（不依赖 Node path 模块）。 */
function normalizePathForPolicy(input: string): string {
  const expanded = expandEnvVarsSafe(input)
  const parts: string[] = []
  for (const segment of expanded.replace(/\//g, '\\').split('\\')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  if (parts.length === 0) return ''
  const drive = /^[a-z]:$/i.test(parts[0]) ? parts.shift()!.toLowerCase() : ''
  const tail = parts.join('\\')
  return drive ? `${drive}\\${tail}`.toLowerCase() : tail.toLowerCase()
}

function expandEnvVarsSafe(input: string): string {
  const fallbacks: Record<string, string> = {
    SystemDrive: 'C:',
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)'
  }
  return input.replace(/%([^%]+)%/g, (_, name: string) => {
    if (typeof process !== 'undefined' && process.env?.[name]) {
      return process.env[name]!
    }
    return fallbacks[name] ?? `%${name}%`
  })
}

function isProtectedPathForPolicy(path: string, protectedPaths: string[]): boolean {
  const normalized = normalizePathForPolicy(path)
  return protectedPaths.some((entry) => {
    const blocked = normalizePathForPolicy(entry)
    if (normalized === blocked) return true
    if (/^[a-z]:\\$/.test(blocked)) return false
    return normalized.startsWith(blocked + '\\')
  })
}

function expandPolicyPaths(paths: string[]): string[] {
  return paths.map((entry) => normalizePathForPolicy(entry))
}

/** 路径访问层级：读取与删除权限分离。 */
export type PathAccessTier = 'normal' | 'denyDelete' | 'readOnlyHighRisk' | 'denyRead'

export interface PathAccessPolicy {
  denyRead: string[]
  readOnlyHighRisk: string[]
  denyDelete: string[]
}

export const DEFAULT_PATH_ACCESS_POLICY: PathAccessPolicy = {
  denyRead: [
    '%SystemDrive%\\',
    '%SystemRoot%\\System32',
    '%SystemRoot%\\SysWOW64',
    '%SystemRoot%\\WinSxS',
    '%SystemRoot%\\Installer'
  ],
  readOnlyHighRisk: ['%ProgramFiles%', '%ProgramFiles(x86)%'],
  denyDelete: []
}

function matchesPrefix(normalizedPath: string, prefix: string): boolean {
  const blocked = normalizePathForPolicy(prefix)
  if (normalizedPath === blocked) return true
  if (/^[a-z]:\\$/.test(blocked)) return false
  return normalizedPath.startsWith(blocked + '\\')
}

export function resolvePathAccessTier(
  path: string,
  policy: PathAccessPolicy = DEFAULT_PATH_ACCESS_POLICY
): PathAccessTier {
  const normalized = normalizePathForPolicy(path)
  const denyRead = expandPolicyPaths(policy.denyRead)
  const readOnly = expandPolicyPaths(policy.readOnlyHighRisk)
  const denyDelete = expandPolicyPaths(policy.denyDelete)

  if (denyRead.some((entry) => matchesPrefix(normalized, entry))) {
    return 'denyRead'
  }
  if (readOnly.some((entry) => matchesPrefix(normalized, entry))) {
    return 'readOnlyHighRisk'
  }
  if (denyDelete.some((entry) => matchesPrefix(normalized, entry))) {
    return 'denyDelete'
  }
  return 'normal'
}

/** 调查工具是否允许只读访问（denyRead 禁止，readOnlyHighRisk 允许受限摘要）。 */
export function isPathReadableForInvestigation(
  path: string,
  policy: PathAccessPolicy = DEFAULT_PATH_ACCESS_POLICY
): boolean {
  return resolvePathAccessTier(path, policy) !== 'denyRead'
}

/** 是否禁止普通删除（含 legacy protected 列表与策略层 denyDelete/readOnlyHighRisk/denyRead）。 */
export function isPathOrdinaryDeleteForbidden(
  path: string,
  protectedPaths: string[],
  policy: PathAccessPolicy = DEFAULT_PATH_ACCESS_POLICY
): boolean {
  if (isProtectedPathForPolicy(path, protectedPaths)) return true
  const tier = resolvePathAccessTier(path, policy)
  return tier === 'denyRead' || tier === 'readOnlyHighRisk' || tier === 'denyDelete'
}

/** 5B 候选：仅 readOnlyHighRisk 路径可作为 high-risk-readable 调查目标。 */
export function isHighRiskReadableCandidate(
  path: string,
  policy: PathAccessPolicy = DEFAULT_PATH_ACCESS_POLICY
): boolean {
  return resolvePathAccessTier(path, policy) === 'readOnlyHighRisk'
}
