import { createHash } from 'crypto'
import type { Stats } from 'fs'
import { existsSync } from 'fs'
import { lstat, realpath } from 'fs/promises'
import { resolve } from 'path'
import {
  captureFilesystemIdentity,
  compareCandidateFileSize,
  compareCandidateMtimeMs,
  filesystemIdentitiesMatch,
  filesystemIdentityAnchorMatch,
  type FilesystemIdentity
} from '../../shared/filesystem-identity'
import type { EntryKind } from '../../shared/types'
import { expandEnvVars, isPathUnderRoot, normalizePath } from '../../shared/path-utils'
import { isPathAuthorizedByRule } from '../../shared/rule-match'
import { isPathOrdinaryDeleteForbidden } from '../../shared/path-access-policy'
import type { CleanupAuthorizationSource } from '../../shared/session-cleanup-authorization'
import type { RuleWithMeta, ScanCandidate } from '../../shared/types'
import {
  DEFAULT_MEASURE_MAX_DEPTH,
  measurePathDetailedWithTimeout
} from '../scanner/measure-size'

export interface CleanupExecutionSnapshot {
  candidateId: string
  logicalPath: string
  resolvedPath: string
  authorizationSource: CleanupAuthorizationSource
  ruleId: string
  parentTarget?: string
  identity: FilesystemIdentity
  /** 内部完整性校验，检测快照结构被误改；非安全边界，Renderer 不应接触快照。 */
  seal: string
}

export type IdentityLstat = (path: string) => Promise<Stats>

export type SnapshotValidationDeps = {
  lstat: IdentityLstat
  measureDirectorySize: (path: string) => Promise<{ size: number; incomplete: boolean }>
}

export type SnapshotVerifyDeps = {
  lstat: IdentityLstat
  realpath: (path: string) => Promise<string>
  measureDirectorySize: (path: string) => Promise<{ size: number; incomplete: boolean }>
  existsSync: (path: string) => boolean
}

export type SnapshotValidationResult =
  | { ok: true; snapshot: CleanupExecutionSnapshot }
  | { ok: false; reason: string }

export const lstatIdentity = ((path: string) => lstat(path, { bigint: true })) as unknown as IdentityLstat

async function measureDirectorySize(resolvedPath: string): Promise<{ size: number; incomplete: boolean }> {
  const measured = await measurePathDetailedWithTimeout(resolvedPath, DEFAULT_MEASURE_MAX_DEPTH)
  return { size: measured.size, incomplete: measured.incomplete }
}

const defaultSnapshotValidationDeps: SnapshotValidationDeps = {
  lstat: lstatIdentity,
  measureDirectorySize
}

const defaultSnapshotVerifyDeps: SnapshotVerifyDeps = {
  lstat: lstatIdentity,
  realpath: (path) => realpath(path),
  measureDirectorySize,
  existsSync: (path) => existsSync(path)
}

function sealSnapshot(input: Omit<CleanupExecutionSnapshot, 'seal'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        candidateId: input.candidateId,
        logicalPath: input.logicalPath,
        resolvedPath: input.resolvedPath,
        authorizationSource: input.authorizationSource,
        ruleId: input.ruleId,
        parentTarget: input.parentTarget ?? null,
        identity: input.identity
      })
    )
    .digest('hex')
    .slice(0, 24)
}

function resolveStatsEntryKind(stats: Stats): EntryKind | null {
  if (stats.isSymbolicLink()) return null
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  return null
}

function buildSnapshotBody(input: {
  candidate: ScanCandidate
  resolvedPath: string
  authorizationSource: CleanupAuthorizationSource
  identity: FilesystemIdentity
}): Omit<CleanupExecutionSnapshot, 'seal'> {
  return {
    candidateId: input.candidate.id,
    logicalPath: input.candidate.path,
    resolvedPath: input.resolvedPath,
    authorizationSource: input.authorizationSource,
    ruleId: input.candidate.ruleId,
    parentTarget: input.candidate.parentTarget,
    identity: input.identity
  }
}

async function verifyDirectoryAfterMeasurement(
  anchor: FilesystemIdentity,
  resolvedPath: string,
  expectedMeasuredSize: number,
  deps: Pick<SnapshotVerifyDeps, 'lstat' | 'measureDirectorySize'>
): Promise<string | null> {
  const measured = await deps.measureDirectorySize(resolvedPath)
  if (measured.incomplete) {
    return '目录快照不完整，无法安全清理'
  }
  if (measured.size !== expectedMeasuredSize) {
    return '目录大小与扫描时不一致'
  }

  let infoAfterMeasure: Stats
  try {
    infoAfterMeasure = await deps.lstat(resolvedPath)
  } catch {
    return '无法读取文件状态'
  }

  if (infoAfterMeasure.isSymbolicLink()) {
    return '符号链接不允许'
  }

  if (!filesystemIdentityAnchorMatch(anchor, infoAfterMeasure)) {
    return '文件对象身份自验证后已变化'
  }

  return null
}

export async function validateAndCreateCleanupExecutionSnapshot(
  input: {
    candidate: ScanCandidate
    resolvedPath: string
    authorizationSource: CleanupAuthorizationSource
  },
  deps: SnapshotValidationDeps = defaultSnapshotValidationDeps
): Promise<SnapshotValidationResult> {
  let info: Stats
  try {
    info = await deps.lstat(input.resolvedPath)
  } catch {
    return { ok: false, reason: '无法读取文件状态' }
  }

  if (info.isSymbolicLink()) {
    return { ok: false, reason: '符号链接不允许' }
  }

  const actualKind = resolveStatsEntryKind(info)
  if (!actualKind) {
    return { ok: false, reason: '不支持的特殊文件类型' }
  }

  if (input.candidate.entryKind !== actualKind) {
    return { ok: false, reason: '路径类型自扫描后已变化' }
  }

  if (!compareCandidateMtimeMs(input.candidate.mtimeMs, info)) {
    return { ok: false, reason: '自扫描后已发生变化' }
  }

  let identity: FilesystemIdentity
  try {
    identity = captureFilesystemIdentity(info, actualKind)
  } catch {
    return { ok: false, reason: '无法捕获文件系统身份' }
  }

  if (actualKind === 'file') {
    try {
      if (!compareCandidateFileSize(input.candidate.size, info)) {
        return { ok: false, reason: '文件大小与扫描时不一致' }
      }
    } catch {
      return { ok: false, reason: '无法捕获文件系统身份' }
    }
  } else {
    if (input.candidate.snapshotComplete === false) {
      return { ok: false, reason: '目录快照不完整，无法安全清理' }
    }
    const measured = await deps.measureDirectorySize(input.resolvedPath)
    if (measured.incomplete) {
      return { ok: false, reason: '目录快照不完整，无法安全清理' }
    }
    if (measured.size !== input.candidate.size) {
      return { ok: false, reason: '目录大小与扫描时不一致' }
    }
    identity = { ...identity, size: String(measured.size) }

    const anchorError = await verifyDirectoryAfterMeasurement(
      identity,
      input.resolvedPath,
      measured.size,
      deps
    )
    if (anchorError) {
      return { ok: false, reason: anchorError }
    }
  }

  const body = buildSnapshotBody({ ...input, identity })
  return { ok: true, snapshot: { ...body, seal: sealSnapshot(body) } }
}

/** @deprecated 请使用 validateAndCreateCleanupExecutionSnapshot */
export async function createCleanupExecutionSnapshot(input: {
  candidate: ScanCandidate
  resolvedPath: string
  authorizationSource: CleanupAuthorizationSource
}): Promise<CleanupExecutionSnapshot> {
  const result = await validateAndCreateCleanupExecutionSnapshot(input)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return result.snapshot
}

export function verifySnapshotSeal(snapshot: CleanupExecutionSnapshot): boolean {
  const { seal, ...body } = snapshot
  return seal === sealSnapshot(body)
}

export function buildCleanupExecutionSnapshotForTests(
  body: Omit<CleanupExecutionSnapshot, 'seal'>
): CleanupExecutionSnapshot {
  return { ...body, seal: sealSnapshot(body) }
}

export async function verifyCleanupExecutionSnapshot(
  snapshot: CleanupExecutionSnapshot,
  options: {
    protectedPaths: string[]
    pathAccessPolicy: ReturnType<typeof import('../rules').getPathAccessPolicy>
    ruleMeta?: RuleWithMeta | null
  },
  deps: SnapshotVerifyDeps = defaultSnapshotVerifyDeps
): Promise<string | null> {
  if (!verifySnapshotSeal(snapshot)) {
    return '执行快照无效'
  }

  if (!deps.existsSync(snapshot.logicalPath)) {
    return '路径不存在或无法访问'
  }

  let resolvedPath: string
  try {
    const absolute = resolve(expandEnvVars(snapshot.logicalPath))
    resolvedPath = await deps.realpath(absolute)
  } catch {
    return '路径不存在或无法访问'
  }

  if (resolvedPath !== snapshot.resolvedPath) {
    return '路径解析异常（可能为符号链接）'
  }

  const normalizedInput = normalizePath(snapshot.logicalPath)
  const normalizedResolved = normalizePath(resolvedPath)
  if (normalizedInput !== normalizedResolved && !isPathUnderRoot(normalizedResolved, normalizedInput)) {
    return '路径解析异常（可能为符号链接）'
  }

  if (isPathOrdinaryDeleteForbidden(resolvedPath, options.protectedPaths, options.pathAccessPolicy)) {
    return '路径在系统保护范围内'
  }

  if (options.ruleMeta && snapshot.authorizationSource === 'local-rule') {
    if (
      !(await isPathAuthorizedByRule(resolvedPath, options.ruleMeta, {
        parentTarget: snapshot.parentTarget
      }))
    ) {
      return '路径未精确匹配规则范围'
    }
  }

  let info: Stats
  try {
    info = await deps.lstat(resolvedPath)
  } catch {
    return '无法读取文件状态'
  }

  if (info.isSymbolicLink()) {
    return '符号链接不允许'
  }

  if (!filesystemIdentitiesMatch(snapshot.identity, info)) {
    return '文件对象身份自验证后已变化'
  }

  if (snapshot.identity.entryKind === 'directory') {
    const expectedSize = Number(snapshot.identity.size)
    if (!Number.isFinite(expectedSize)) {
      return '目录大小与扫描时不一致'
    }
    return verifyDirectoryAfterMeasurement(snapshot.identity, resolvedPath, expectedSize, deps)
  }

  return null
}
