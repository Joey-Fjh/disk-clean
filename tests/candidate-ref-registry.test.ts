import { describe, expect, it } from 'vitest'
import {
  clearCandidateRefMaps,
  getRegisteredRefMap,
  registerCandidateRefMap,
  releaseCandidateRefMap
} from '../src/main/agent/investigation/candidate-ref'
import { INVESTIGATION_LIMITS } from '../src/shared/investigation-limits'

describe('candidate ref registry', () => {
  it('clears all ref maps on new scan and releases after investigation', () => {
    clearCandidateRefMaps()
    const mapA = new Map([['candidate-1', 'id-a']])
    const mapB = new Map([['candidate-1', 'id-b']])

    registerCandidateRefMap('session-a:0', mapA)
    registerCandidateRefMap('session-b:0', mapB)
    expect(getRegisteredRefMap('session-a:0')).toBe(mapA)
    expect(getRegisteredRefMap('session-b:0')).toBe(mapB)

    clearCandidateRefMaps()
    expect(getRegisteredRefMap('session-a:0')).toBeUndefined()
    expect(getRegisteredRefMap('session-b:0')).toBeUndefined()

    registerCandidateRefMap('session-c:0', mapA)
    releaseCandidateRefMap('session-c:0')
    expect(getRegisteredRefMap('session-c:0')).toBeUndefined()
  })

  it('prunes oldest ref maps when history exceeds limit', () => {
    clearCandidateRefMaps()
    const limit = INVESTIGATION_LIMITS.MAX_TERMINAL_HISTORY_ENTRIES
    for (let i = 0; i < limit + 3; i += 1) {
      registerCandidateRefMap(`fp-${i}`, new Map([['candidate-1', `id-${i}`]]))
    }
    expect(getRegisteredRefMap('fp-0')).toBeUndefined()
    expect(getRegisteredRefMap('fp-1')).toBeUndefined()
    expect(getRegisteredRefMap('fp-2')).toBeUndefined()
    expect(getRegisteredRefMap(`fp-${limit + 2}`)).toBeDefined()
  })
})
