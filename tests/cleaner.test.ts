import { describe, expect, it, vi } from 'vitest'
import { executeCleanup } from '../src/main/cleanup/cleaner'
import type { ValidatedAction } from '../src/main/cleanup/safety-validator'

vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn(async () => undefined)
  }
}))

describe('cleaner semantics', () => {
  it('reports movedToTrashBytes not actuallyReclaimedBytes', async () => {
    const actions: ValidatedAction[] = [
      {
        candidateId: 'a',
        ruleId: 'r',
        target: 'C:\\temp\\a.txt',
        operation: 'trash',
        estimatedLogicalBytes: 1024,
        resolvedPath: 'C:\\temp\\a.txt'
      }
    ]

    const result = await executeCleanup('plan-1', actions, [])
    expect(result.movedToTrashBytes).toBe(1024)
    expect(result.actuallyReclaimedBytes).toBe(0)
    expect(result.reclaimState).toBe('pending')
    expect(result.recoveryMode).toBe('recycle-bin')
    expect(result.moved).toBe(1)
  })
})
