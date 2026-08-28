import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PATH_ACCESS_POLICY,
  isHighRiskReadableCandidate,
  isPathReadableForInvestigation,
  resolvePathAccessTier
} from '../src/shared/path-access-policy'

describe('path access policy', () => {
  it('denies read for system directories', () => {
    expect(resolvePathAccessTier('C:\\Windows\\System32\\kernel32.dll', DEFAULT_PATH_ACCESS_POLICY)).toBe(
      'denyRead'
    )
    expect(isPathReadableForInvestigation('C:\\Windows\\System32', DEFAULT_PATH_ACCESS_POLICY)).toBe(false)
  })

  it('allows read-only investigation for Program Files but marks high-risk readable', () => {
    expect(resolvePathAccessTier('C:\\Program Files\\Vendor\\app', DEFAULT_PATH_ACCESS_POLICY)).toBe(
      'readOnlyHighRisk'
    )
    expect(isPathReadableForInvestigation('C:\\Program Files\\Vendor', DEFAULT_PATH_ACCESS_POLICY)).toBe(
      true
    )
    expect(isHighRiskReadableCandidate('C:\\Program Files\\Vendor', DEFAULT_PATH_ACCESS_POLICY)).toBe(
      true
    )
  })

  it('treats normal user paths as normal tier', () => {
    expect(resolvePathAccessTier('C:\\Users\\me\\Downloads\\file.zip', DEFAULT_PATH_ACCESS_POLICY)).toBe(
      'normal'
    )
  })
})
