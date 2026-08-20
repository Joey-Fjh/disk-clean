import { resolve, normalize } from 'path'

export function expandEnvVars(input: string): string {
  return input.replace(/%([^%]+)%/g, (_, name: string) => {
    return process.env[name] ?? `%${name}%`
  })
}

export function normalizePath(input: string): string {
  return normalize(resolve(expandEnvVars(input))).replace(/\//g, '\\').toLowerCase()
}

export function isProtectedPath(path: string, protectedPaths: string[]): boolean {
  const normalized = normalizePath(path)
  return protectedPaths.some((entry) => {
    const blocked = normalizePath(entry)
    if (normalized === blocked) return true
    if (/^[a-z]:\\$/.test(blocked)) return false
    return normalized.startsWith(blocked + '\\')
  })
}

/** @deprecated 使用 isProtectedPath */
export function isBlacklisted(path: string, protectedPaths: string[]): boolean {
  return isProtectedPath(path, protectedPaths)
}

export function isPathUnderRoot(targetPath: string, rootPath: string): boolean {
  const target = normalizePath(targetPath)
  const root = normalizePath(rootPath)
  return target === root || target.startsWith(root + '\\')
}
