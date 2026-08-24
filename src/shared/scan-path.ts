/** 用于扫描结果去重的路径键：统一斜杠、去除尾部分隔符、Windows 不区分大小写。 */
export function normalizeScanPath(path: string): string {
  let normalized = path.replace(/\//g, '\\').trim()
  if (!normalized) return normalized

  if (normalized.startsWith('\\\\')) {
    let rest = normalized.slice(2).replace(/\\+/g, '\\')
    if (rest.startsWith('\\')) rest = rest.slice(1)
    normalized = '\\\\' + rest
    if (normalized.length > 3) {
      normalized = normalized.replace(/\\+$/, '')
    }
    return normalized.toLowerCase()
  }

  normalized = normalized.replace(/\\+/g, '\\')

  if (/^[a-z]:\\$/i.test(normalized)) {
    return normalized.toLowerCase()
  }

  normalized = normalized.replace(/\\+$/, '')
  return normalized.toLowerCase()
}
