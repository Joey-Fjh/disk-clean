import { describe, expect, it } from 'vitest'
import { InvestigationResultCache } from '../src/main/agent/investigation/investigation-cache'

describe('investigation cache', () => {
  it('isolates entries by fingerprint', () => {
    const cache = new InvestigationResultCache()
    const keyA = {
      fingerprint: 'a:1:0',
      candidateRef: 'candidate-1',
      toolName: 'list_children' as const,
      relativePath: ''
    }
    const keyB = { ...keyA, fingerprint: 'b:1:0' }
    cache.set(keyA, {
      tool: 'list_children',
      relativePath: '.',
      entries: [],
      truncated: false,
      untrustedDataNotice: 'x'
    })
    expect(cache.get(keyA)).toBeDefined()
    expect(cache.get(keyB)).toBeUndefined()
  })
})
