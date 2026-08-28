import { join, relative, resolve } from 'path'
import { lstat, realpath } from 'fs/promises'
import type { ScanCandidate } from '../../../shared/types'
import { expandEnvVars, isPathUnderRoot, normalizePath } from '../../../shared/path-utils'
import {
  DEFAULT_PATH_ACCESS_POLICY,
  isPathReadableForInvestigation,
  type PathAccessPolicy
} from '../../../shared/path-access-policy'
import { InvestigationError } from './investigation-errors'

const NULL_BYTE = /\0/
const ABSOLUTE_PATH = /^([a-zA-Z]:[\\/]|\\\\)/
const PARENT_SEGMENT = /(^|[\\/])\.\.([\\/]|$)/

export interface ResolvedInvestigationPath {
  candidateRoot: string
  targetPath: string
  relativePath: string
}

export function normalizeRelativePath(input: string | undefined): string {
  if (input === undefined || input === '') return ''
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (NULL_BYTE.test(trimmed)) {
    throw new InvestigationError('INVALID_RELATIVE_PATH', '相对路径无效')
  }
  if (ABSOLUTE_PATH.test(trimmed)) {
    throw new InvestigationError('INVALID_RELATIVE_PATH', '不允许绝对路径')
  }
  if (PARENT_SEGMENT.test(trimmed)) {
    throw new InvestigationError('INVALID_RELATIVE_PATH', '不允许路径穿越')
  }

  const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/').filter((segment) => segment.length > 0 && segment !== '.')
  for (const segment of segments) {
    if (segment === '..') {
      throw new InvestigationError('INVALID_RELATIVE_PATH', '不允许路径穿越')
    }
  }
  return segments.join('/')
}

async function assertLogicalSegmentPathSafe(
  candidateRoot: string,
  targetPath: string,
  accessPolicy: PathAccessPolicy
): Promise<void> {
  if (!isPathReadableForInvestigation(candidateRoot, accessPolicy)) {
    throw new InvestigationError('PROTECTED_PATH', '目标路径受保护')
  }
  if (!isPathReadableForInvestigation(targetPath, accessPolicy)) {
    throw new InvestigationError('PROTECTED_PATH', '目标路径受保护')
  }

  const rel = relative(candidateRoot, targetPath)
  if (rel.startsWith('..') || rel.split(/[\\/]/).includes('..')) {
    throw new InvestigationError('PATH_OUTSIDE_CANDIDATE', '目标路径超出候选范围')
  }

  if (!rel || rel === '.') return

  const segments = rel.split(/[\\/]/).filter(Boolean)
  let current = candidateRoot
  for (const segment of segments) {
    const next = join(current, segment)
    let info
    try {
      info = await lstat(next)
    } catch {
      throw new InvestigationError('IO_ERROR', '无法读取目标路径')
    }
    if (info.isSymbolicLink()) {
      throw new InvestigationError('REPARSE_POINT_BLOCKED', '符号链接或联接点不允许')
    }
    if (!isPathReadableForInvestigation(next, accessPolicy)) {
      throw new InvestigationError('PROTECTED_PATH', '目标路径受保护')
    }
    current = next
  }
}

export async function resolveInvestigationPath(options: {
  candidate: ScanCandidate
  relativePath?: string
  protectedPaths: string[]
  accessPolicy?: PathAccessPolicy
}): Promise<ResolvedInvestigationPath> {
  const accessPolicy = options.accessPolicy ?? DEFAULT_PATH_ACCESS_POLICY
  const relativePath = normalizeRelativePath(options.relativePath)
  const candidateRoot = resolve(expandEnvVars(options.candidate.path))

  let targetPath: string
  if (!relativePath) {
    targetPath = candidateRoot
  } else {
    const joined = join(candidateRoot, ...relativePath.split('/'))
    targetPath = resolve(joined)
  }

  if (!isPathUnderRoot(targetPath, candidateRoot)) {
    throw new InvestigationError('PATH_OUTSIDE_CANDIDATE', '目标路径超出候选范围')
  }

  if (!isPathReadableForInvestigation(targetPath, accessPolicy)) {
    throw new InvestigationError('PROTECTED_PATH', '目标路径受保护')
  }

  await assertLogicalSegmentPathSafe(candidateRoot, targetPath, accessPolicy)

  let realCandidateRoot: string
  try {
    realCandidateRoot = await realpath(candidateRoot)
  } catch {
    throw new InvestigationError('IO_ERROR', '无法读取候选目录')
  }

  if (!isPathReadableForInvestigation(realCandidateRoot, accessPolicy)) {
    throw new InvestigationError('PROTECTED_PATH', '目标路径受保护')
  }

  if (!isPathUnderRoot(targetPath, realCandidateRoot)) {
    throw new InvestigationError('PATH_OUTSIDE_CANDIDATE', '目标路径超出候选范围')
  }

  let realTarget: string
  try {
    realTarget = await realpath(targetPath)
  } catch {
    throw new InvestigationError('IO_ERROR', '无法读取目标路径')
  }

  if (!isPathUnderRoot(realTarget, realCandidateRoot)) {
    throw new InvestigationError('PATH_OUTSIDE_CANDIDATE', '目标路径超出候选范围')
  }

  if (!isPathReadableForInvestigation(realTarget, accessPolicy)) {
    throw new InvestigationError('PROTECTED_PATH', '目标路径受保护')
  }

  try {
    const info = await lstat(targetPath)
    if (info.isSymbolicLink()) {
      throw new InvestigationError('REPARSE_POINT_BLOCKED', '符号链接或联接点不允许')
    }
  } catch (error) {
    if (error instanceof InvestigationError) throw error
    throw new InvestigationError('IO_ERROR', '无法读取目标路径')
  }

  return { candidateRoot: realCandidateRoot, targetPath: realTarget, relativePath }
}

export async function assertDirectoryTarget(targetPath: string): Promise<void> {
  try {
    const info = await lstat(targetPath)
    if (info.isSymbolicLink()) {
      throw new InvestigationError('REPARSE_POINT_BLOCKED', '符号链接或联接点不允许')
    }
    if (!info.isDirectory()) {
      throw new InvestigationError('INVALID_RELATIVE_PATH', '目标不是目录')
    }
  } catch (error) {
    if (error instanceof InvestigationError) throw error
    throw new InvestigationError('IO_ERROR', '无法读取目标目录')
  }
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b)
}
