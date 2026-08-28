import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { handleCleanupExecute, handleCleanupPrepare } from '../src/main/cleanup/cleanup-ipc'
import { setTrustedSenderCheckerForTests } from '../src/main/window-security'

function mockSender(id: number) {
  return { id } as never
}

describe('cleanup ipc security', () => {
  beforeEach(() => {
    setTrustedSenderCheckerForTests((sender) => sender.id === 1)
  })

  afterEach(() => {
    setTrustedSenderCheckerForTests(null)
  })

  it('rejects untrusted sender', async () => {
    const result = await handleCleanupPrepare({ sender: mockSender(99) } as never, {
      sessionId: 'session-1',
      fingerprint: 'fp',
      candidateIds: ['c1']
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('IPC_UNAUTHORIZED')
    }
  })

  it('rejects unknown fields in prepare payload', async () => {
    const result = await handleCleanupPrepare({ sender: mockSender(1) } as never, {
      sessionId: 'session-1',
      fingerprint: 'fp',
      candidateIds: ['c1'],
      path: 'C:\\evil'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT')
    }
  })

  it('rejects execute payload without confirmationId', async () => {
    const result = await handleCleanupExecute({ sender: mockSender(1) } as never, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT')
    }
  })
})
