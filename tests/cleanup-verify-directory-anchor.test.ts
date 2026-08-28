import type { Stats } from 'fs'
import { describe, expect, it } from 'vitest'
import {
  buildCleanupExecutionSnapshotForTests,
  verifyCleanupExecutionSnapshot
} from '../src/main/cleanup/cleanup-execution-guard'
import type { FilesystemIdentity } from '../src/shared/filesystem-identity'
import type { CleanupAuthorizationSource } from '../src/shared/session-cleanup-authorization'

function bigintDirStats(ino: bigint): Stats {
  return {
    dev: 9n,
    ino,
    birthtimeNs: 1000n,
    ctimeNs: 2000n,
    mtimeNs: 3000n,
    birthtimeMs: 1,
    ctimeMs: 2,
    mtimeMs: 3,
    size: 0n,
    isSymbolicLink: () => false,
    isFile: () => false,
    isDirectory: () => true,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false
  } as Stats
}

function sealedDirectorySnapshot(identity: FilesystemIdentity) {
  return buildCleanupExecutionSnapshotForTests({
    candidateId: 'd1',
    logicalPath: 'C:\\cache',
    resolvedPath: 'C:\\cache',
    authorizationSource: 'agent-session' as CleanupAuthorizationSource,
    ruleId: 'r1',
    identity
  })
}

const baseIdentity: FilesystemIdentity = {
  captureMode: 'bigint-native',
  dev: '9',
  ino: '100',
  birthtimeNs: '1000',
  ctimeNs: '2000',
  mtimeNs: '3000',
  size: '400',
  entryKind: 'directory'
}

const policy = { denyRead: [], readOnlyHighRisk: [], denyDelete: [] }

describe('verifyCleanupExecutionSnapshot directory anchor re-check', () => {
  it('rejects when directory identity changes during measurement with same total size', async () => {
    let lstatCalls = 0
    const error = await verifyCleanupExecutionSnapshot(
      sealedDirectorySnapshot(baseIdentity),
      { protectedPaths: [], pathAccessPolicy: policy },
      {
        existsSync: () => true,
        realpath: async () => 'C:\\cache',
        measureDirectorySize: async () => ({ size: 400, incomplete: false }),
        lstat: async () => {
          lstatCalls += 1
          return bigintDirStats(lstatCalls === 1 ? 100n : 101n)
        }
      }
    )
    expect(error).toContain('身份')
  })

  it('rejects when directory disappears after measurement', async () => {
    let lstatCalls = 0
    const error = await verifyCleanupExecutionSnapshot(
      sealedDirectorySnapshot(baseIdentity),
      { protectedPaths: [], pathAccessPolicy: policy },
      {
        existsSync: () => true,
        realpath: async () => 'C:\\cache',
        measureDirectorySize: async () => ({ size: 400, incomplete: false }),
        lstat: async () => {
          lstatCalls += 1
          if (lstatCalls === 1) return bigintDirStats(100n)
          throw new Error('ENOENT')
        }
      }
    )
    expect(error).toContain('无法读取')
  })

  it('rejects when directory becomes symlink after measurement', async () => {
    let lstatCalls = 0
    const error = await verifyCleanupExecutionSnapshot(
      sealedDirectorySnapshot(baseIdentity),
      { protectedPaths: [], pathAccessPolicy: policy },
      {
        existsSync: () => true,
        realpath: async () => 'C:\\cache',
        measureDirectorySize: async () => ({ size: 400, incomplete: false }),
        lstat: async () => {
          lstatCalls += 1
          if (lstatCalls === 1) return bigintDirStats(100n)
          return {
            ...bigintDirStats(100n),
            isSymbolicLink: () => true,
            isDirectory: () => false
          } as Stats
        }
      }
    )
    expect(error).toContain('符号链接')
  })

  it('rejects incomplete directory measurement', async () => {
    const error = await verifyCleanupExecutionSnapshot(
      sealedDirectorySnapshot(baseIdentity),
      { protectedPaths: [], pathAccessPolicy: policy },
      {
        existsSync: () => true,
        realpath: async () => 'C:\\cache',
        measureDirectorySize: async () => ({ size: 400, incomplete: true }),
        lstat: async () => bigintDirStats(100n)
      }
    )
    expect(error).toContain('不完整')
  })

  it('allows unchanged directory after measurement anchor re-check', async () => {
    const error = await verifyCleanupExecutionSnapshot(
      sealedDirectorySnapshot(baseIdentity),
      { protectedPaths: [], pathAccessPolicy: policy },
      {
        existsSync: () => true,
        realpath: async () => 'C:\\cache',
        measureDirectorySize: async () => ({ size: 400, incomplete: false }),
        lstat: async () => bigintDirStats(100n)
      }
    )
    expect(error).toBeNull()
  })
})
