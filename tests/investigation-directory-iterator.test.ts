import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { entriesObserved } = vi.hoisted(() => ({
  entriesObserved: { value: 0 }
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    async opendir(path: string, options?: Parameters<typeof actual.opendir>[1]) {
      const dir = await actual.opendir(path, options)
      const originalIterator = dir[Symbol.asyncIterator].bind(dir)
      return {
        ...dir,
        async close() {
          await dir.close()
        },
        async *[Symbol.asyncIterator]() {
          for await (const entry of originalIterator()) {
            entriesObserved.value += 1
            yield entry
          }
        }
      }
    }
  }
})

import { iterateDirectoryEntries } from '../src/main/agent/investigation/directory-iterator'

describe('streaming directory iteration', () => {
  let root = ''

  beforeEach(() => {
    entriesObserved.value = 0
    root = mkdtempSync(join(tmpdir(), 'disk-clean-stream-dir-'))
    for (let i = 0; i < 200; i += 1) {
      writeFileSync(join(root, `entry-${i}.tmp`), 'x')
    }
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('stops iterating once the entry budget is reached', async () => {
    const result = await iterateDirectoryEntries(root, {
      maxEntriesToRead: 12,
      onEntry: async () => 'continue'
    })

    expect(result.truncated).toBe(true)
    expect(entriesObserved.value).toBeLessThanOrEqual(13)
    expect(entriesObserved.value).toBeLessThan(200)
  })
})
