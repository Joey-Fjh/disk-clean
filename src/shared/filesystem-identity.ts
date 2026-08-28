import type { Stats } from 'fs'
import type { EntryKind } from './types'

export type FilesystemIdentityCaptureMode = 'bigint-native' | 'timestamp-fallback'

/** 执行前文件系统对象身份（来自 bigint lstat，非 ScanCandidate 字段）。 */
export interface FilesystemIdentity {
  captureMode: FilesystemIdentityCaptureMode
  dev: string
  ino: string
  birthtimeNs: string
  ctimeNs: string
  mtimeNs: string
  /** 文件为 lstat size；目录为递归测量值。均以字符串保存。 */
  size: string
  entryKind: EntryKind
}

type BigIntStat = Stats & {
  birthtimeNs?: bigint
  ctimeNs?: bigint
  mtimeNs?: bigint
}

export class FilesystemIdentityCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FilesystemIdentityCaptureError'
  }
}

export function normalizeBigIntField(value: number | bigint | undefined): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return '0'
}

export function isInodeAnchorReliable(identity: Pick<FilesystemIdentity, 'dev' | 'ino'>): boolean {
  return identity.dev !== '0' && identity.ino !== '0'
}

function statsMtimeMsBucket(stats: Stats): bigint {
  const bigintStats = stats as BigIntStat
  if (typeof bigintStats.mtimeNs === 'bigint') {
    return bigintStats.mtimeNs / 1_000_000n
  }
  const raw = stats.mtimeMs as number | bigint
  if (typeof raw === 'bigint') return raw
  return BigInt(Math.trunc(raw))
}

function statsMsToNsFallback(ms: number | bigint): string {
  if (typeof ms === 'bigint') return (ms * 1_000_000n).toString()
  return String(Math.round(ms * 1_000_000))
}

function readBigIntNs(stats: BigIntStat, key: 'birthtimeNs' | 'ctimeNs' | 'mtimeNs', msFallback: number | bigint): string {
  const ns = stats[key]
  if (typeof ns === 'bigint') return ns.toString()
  return statsMsToNsFallback(msFallback)
}

function resolveStatsEntryKind(stats: Stats): EntryKind | null {
  if (stats.isSymbolicLink()) return null
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  return null
}

export function assertBigIntStatSupported(stats: Stats): void {
  if (typeof stats.dev !== 'bigint' || typeof stats.ino !== 'bigint') {
    throw new FilesystemIdentityCaptureError('当前环境未提供 bigint stat，身份捕获失败关闭')
  }
}

export function captureFilesystemIdentity(stats: Stats, entryKind: EntryKind): FilesystemIdentity {
  assertBigIntStatSupported(stats)
  const bigintStats = stats as BigIntStat
  const dev = normalizeBigIntField(stats.dev)
  const ino = normalizeBigIntField(stats.ino)
  const identity: FilesystemIdentity = {
    captureMode: isInodeAnchorReliable({ dev, ino }) ? 'bigint-native' : 'timestamp-fallback',
    dev,
    ino,
    birthtimeNs: readBigIntNs(bigintStats, 'birthtimeNs', stats.birthtimeMs),
    ctimeNs: readBigIntNs(bigintStats, 'ctimeNs', stats.ctimeMs),
    mtimeNs: readBigIntNs(bigintStats, 'mtimeNs', stats.mtimeMs),
    size: normalizeBigIntField(stats.size),
    entryKind
  }
  return identity
}

export function filesystemIdentityAnchorsEqual(
  expected: FilesystemIdentity,
  current: FilesystemIdentity
): boolean {
  if (expected.entryKind !== current.entryKind) return false

  const expectedInodeReliable = isInodeAnchorReliable(expected)
  const currentInodeReliable = isInodeAnchorReliable(current)
  if (expectedInodeReliable && currentInodeReliable) {
    return expected.dev === current.dev && expected.ino === current.ino
  }

  return (
    expected.birthtimeNs === current.birthtimeNs &&
    expected.ctimeNs === current.ctimeNs &&
    expected.mtimeNs === current.mtimeNs
  )
}

/** 比对 inode/时间戳锚点；目录 size 可能来自递归测量，不在此比较 lstat.size。 */
export function filesystemIdentityAnchorMatch(expected: FilesystemIdentity, stats: Stats): boolean {
  const actualKind = resolveStatsEntryKind(stats)
  if (!actualKind || expected.entryKind !== actualKind) return false
  try {
    const current = captureFilesystemIdentity(stats, expected.entryKind)
    return filesystemIdentityAnchorsEqual(expected, current)
  } catch {
    return false
  }
}

export function filesystemIdentitiesMatch(expected: FilesystemIdentity, stats: Stats): boolean {
  if (!filesystemIdentityAnchorMatch(expected, stats)) return false
  if (expected.entryKind === 'file') {
    try {
      assertBigIntStatSupported(stats)
    } catch {
      return false
    }
    return expected.size === normalizeBigIntField(stats.size)
  }
  return true
}

export function compareCandidateMtimeMs(candidateMtimeMs: number | undefined, stats: Stats): boolean {
  if (candidateMtimeMs === undefined) return true
  return statsMtimeMsBucket(stats) === BigInt(Math.trunc(candidateMtimeMs))
}

export function compareCandidateFileSize(candidateSize: number, stats: Stats): boolean {
  assertBigIntStatSupported(stats)
  return String(candidateSize) === normalizeBigIntField(stats.size)
}
