import { homedir } from 'os'

export interface SanitizePathOptions {
  userHome?: string
  userName?: string
}

const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g
const UNC_PATH = /\\\\[^\s\\]+(?:\\[^\s\\]+)+/g
const DRIVE_ABS_PATH = /[A-Za-z]:[\\/][^\s]*/g

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function collapseControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, ' ').replace(/\r\n/g, '\n')
}

function replaceUserHomeInText(text: string, userHome: string): string {
  if (!userHome) return text
  const pattern = new RegExp(escapeRegex(normalizeSlashes(userHome)), 'gi')
  return text.replace(pattern, '<USER_HOME>')
}

function replaceUserNameInText(text: string, userName?: string): string {
  if (!userName || userName.length === 0) return text
  return text.replace(new RegExp(escapeRegex(userName), 'gi'), '<USER>')
}

function replaceDriveRoots(text: string): string {
  return text
    .replace(/[A-Za-z]:\/Program Files \(x86\)/gi, '<PROGRAM_FILES_X86>')
    .replace(/[A-Za-z]:\/Program Files/gi, '<PROGRAM_FILES>')
    .replace(/[A-Za-z]:\/Windows/gi, '<WINDOWS>')
    .replace(/[A-Za-z]:\/?/gi, '<DRIVE>/')
}

/** 将自由文本中任意嵌入的绝对路径整体替换为占位符。 */
export function sanitizeFreeText(text: string, options: SanitizePathOptions = {}): string {
  let result = collapseControlChars(text.trim())
  const userHome = normalizeSlashes(options.userHome ?? homedir())
  const userName = options.userName ?? extractUserName(userHome)

  result = replaceUserHomeInText(result, userHome)
  result = result.replace(UNC_PATH, '<PATH>')
  result = result.replace(DRIVE_ABS_PATH, '<PATH>')
  result = replaceUserNameInText(result, userName)
  return result
}

/** 生成允许发送的有限层级路径摘要。 */
export function sanitizeHierarchyPath(path: string, options: SanitizePathOptions = {}): string {
  let result = collapseControlChars(path.trim())
  result = normalizeSlashes(result)
  const userHome = normalizeSlashes(options.userHome ?? homedir())
  const userName = options.userName ?? extractUserName(userHome)

  if (userHome && result.toLowerCase().startsWith(userHome.toLowerCase())) {
    result = `<USER_HOME>${result.slice(userHome.length)}`
  } else {
    result = replaceUserHomeInText(result, userHome)
  }

  if (result.startsWith('//')) {
    const uncTail = result.replace(/^\/\/[^/]+\/[^/]+/, '<PATH>')
    result = uncTail.startsWith('<PATH>') ? uncTail : `<PATH>${uncTail}`
  }

  result = replaceDriveRoots(result)
  result = replaceUserNameInText(result, userName)
  return result.replace(/^\/+/, '')
}

/** @deprecated 使用 sanitizeHierarchyPath；保留别名以兼容现有调用。 */
export function sanitizePath(path: string, options: SanitizePathOptions = {}): string {
  return sanitizeHierarchyPath(path, options)
}

export function sanitizePathSegment(segment: string, options: SanitizePathOptions = {}): string {
  let value = sanitizeFreeText(segment, options)
  if (value.length > 64) {
    return `${value.slice(0, 32)}…`
  }
  return value
}

export function extractUserName(userHome: string): string | undefined {
  const parts = normalizeSlashes(userHome).split('/').filter(Boolean)
  return parts[parts.length - 1]
}

export function sanitizeFileName(fileName: string, options: SanitizePathOptions = {}): string {
  return sanitizePathSegment(fileName, options)
}

export function containsRawSecrets(text: string, secrets: string[]): boolean {
  return secrets.some((secret) => secret.length > 0 && text.includes(secret))
}
