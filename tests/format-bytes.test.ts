import { describe, expect, it } from 'vitest'
import { formatBytes } from '../src/shared/format-bytes'

const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB
const TB = 1024 * GB

describe('formatBytes', () => {
  it('formats boundary byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(KB)).toBe('1.0 KB')
    expect(formatBytes(MB)).toBe('1.0 MB')
    expect(formatBytes(30 * MB)).toBe('30.0 MB')
    expect(formatBytes(GB)).toBe('1.0 GB')
    expect(formatBytes(TB)).toBe('1.0 TB')
  })
})
