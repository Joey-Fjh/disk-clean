import { describe, expect, it } from 'vitest'
import { getPathSize } from '../src/main/scanner/measure-size'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('scan cancel', () => {
  it('stops recursive size walk when aborted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-cancel-'))
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(root, `f${i}.txt`), 'data')
    }

    const controller = new AbortController()
    controller.abort()
    const size = await getPathSize(root, 0, 4, controller.signal)
    expect(size).toBe(0)
  })
})
