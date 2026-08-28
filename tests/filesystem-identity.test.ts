import { mkdtempSync, writeFileSync, statSync, unlinkSync, utimesSync } from 'fs'
import { lstat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import {
  assertBigIntStatSupported,
  captureFilesystemIdentity,
  FilesystemIdentityCaptureError,
  filesystemIdentitiesMatch,
  filesystemIdentityAnchorsEqual,
  isInodeAnchorReliable,
  normalizeBigIntField
} from '../src/shared/filesystem-identity'
import type { Stats } from 'fs'

function bigintStats(input: {
  dev: bigint
  ino: bigint
  birthtimeNs: bigint
  ctimeNs: bigint
  mtimeNs: bigint
  size: bigint
  mtimeMs?: number
}): Stats {
  return {
    dev: input.dev,
    ino: input.ino,
    birthtimeNs: input.birthtimeNs,
    ctimeNs: input.ctimeNs,
    mtimeNs: input.mtimeNs,
    birthtimeMs: input.mtimeMs ?? Number(input.birthtimeNs / 1_000_000n),
    ctimeMs: input.mtimeMs ?? Number(input.ctimeNs / 1_000_000n),
    mtimeMs: input.mtimeMs ?? Number(input.mtimeNs / 1_000_000n),
    size: input.size,
    isSymbolicLink: () => false,
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false
  } as Stats
}

describe('filesystem identity bigint capture', () => {
  it('preserves dev/ino above Number.MAX_SAFE_INTEGER', () => {
    const stats = bigintStats({
      dev: 9007199254740992n,
      ino: 9007199254740993n,
      birthtimeNs: 1000n,
      ctimeNs: 2000n,
      mtimeNs: 3000n,
      size: 128n
    })
    const identity = captureFilesystemIdentity(stats, 'file')
    expect(identity.dev).toBe('9007199254740992')
    expect(identity.ino).toBe('9007199254740993')
    expect(identity.captureMode).toBe('bigint-native')
  })

  it('does not collide adjacent large inode identities', () => {
    const left = captureFilesystemIdentity(
      bigintStats({
        dev: 9007199254740992n,
        ino: 9007199254740993n,
        birthtimeNs: 1n,
        ctimeNs: 2n,
        mtimeNs: 3n,
        size: 1n
      }),
      'file'
    )
    const right = captureFilesystemIdentity(
      bigintStats({
        dev: 9007199254740992n,
        ino: 9007199254740994n,
        birthtimeNs: 1n,
        ctimeNs: 2n,
        mtimeNs: 3n,
        size: 1n
      }),
      'file'
    )
    expect(filesystemIdentityAnchorsEqual(left, right)).toBe(false)
  })

  it('rejects when bigint ino differs', () => {
    const expected = captureFilesystemIdentity(
      bigintStats({
        dev: 42n,
        ino: 100n,
        birthtimeNs: 1n,
        ctimeNs: 2n,
        mtimeNs: 3n,
        size: 10n
      }),
      'file'
    )
    const current = bigintStats({
      dev: 42n,
      ino: 101n,
      birthtimeNs: 1n,
      ctimeNs: 2n,
      mtimeNs: 3n,
      size: 10n
    })
    expect(filesystemIdentitiesMatch(expected, current)).toBe(false)
  })

  it('matches unchanged bigint identity', () => {
    const stats = bigintStats({
      dev: 7n,
      ino: 99n,
      birthtimeNs: 11n,
      ctimeNs: 22n,
      mtimeNs: 33n,
      size: 64n
    })
    const expected = captureFilesystemIdentity(stats, 'file')
    expect(filesystemIdentitiesMatch(expected, stats)).toBe(true)
  })

  it('uses timestamp fallback when dev/ino are zero', () => {
    const stats = bigintStats({
      dev: 0n,
      ino: 0n,
      birthtimeNs: 100n,
      ctimeNs: 200n,
      mtimeNs: 300n,
      size: 10n
    })
    const identity = captureFilesystemIdentity(stats, 'file')
    expect(identity.captureMode).toBe('timestamp-fallback')
    expect(isInodeAnchorReliable(identity)).toBe(false)
  })

  it('fails closed when bigint stat is unavailable', () => {
    const numberOnly = {
      dev: 1,
      ino: 2,
      birthtimeMs: 1,
      ctimeMs: 2,
      mtimeMs: 3,
      size: 4,
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false
    } as Stats
    expect(() => assertBigIntStatSupported(numberOnly)).toThrow(FilesystemIdentityCaptureError)
    expect(() => captureFilesystemIdentity(numberOnly, 'file')).toThrow(FilesystemIdentityCaptureError)
  })

  it('does not treat String(number) as bigint precision recovery', () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 10
    expect(normalizeBigIntField(unsafe)).toBe(String(unsafe))
    expect(normalizeBigIntField(9007199254740993n)).toBe('9007199254740993')
    expect(normalizeBigIntField(unsafe)).not.toBe('9007199254740993')
  })

  it('detects inode replacement with same size and restored mtime on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-clean-fs-id-'))
    const filePath = join(dir, 'sample.dat')
    writeFileSync(filePath, 'a'.repeat(128))
    const before = await lstat(filePath, { bigint: true })
    const expected = captureFilesystemIdentity(before, 'file')

    unlinkSync(filePath)
    writeFileSync(filePath, 'b'.repeat(128))
    utimesSync(filePath, before.atime, before.mtime)

    const after = await lstat(filePath, { bigint: true })
    expect(filesystemIdentitiesMatch(expected, after)).toBe(false)
  })
})
