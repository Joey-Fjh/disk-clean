import { describe, expect, it } from 'vitest'
import {
  rejectUnexpectedDepth,
  rejectUnexpectedLimit,
  validateDepth,
  validateListLimit,
  validateRelativePathInput,
  validateSessionId
} from '../src/shared/investigation-request-validation'
import { InvestigationValidationError } from '../src/shared/investigation-request-validation'
import { resolveListLimit } from '../src/main/agent/investigation/tool-params'

describe('investigation request validation', () => {
  it('rejects NaN and Infinity limits', () => {
    expect(() => validateListLimit(Number.NaN)).toThrow(InvestigationValidationError)
    expect(() => validateListLimit(Number.POSITIVE_INFINITY)).toThrow(InvestigationValidationError)
    expect(() => validateListLimit(-1)).toThrow(InvestigationValidationError)
    expect(() => validateListLimit(1.5)).toThrow(InvestigationValidationError)
  })

  it('rejects invalid depth values', () => {
    expect(() => validateDepth(Number.NaN)).toThrow(InvestigationValidationError)
    expect(() => validateDepth(-1)).toThrow(InvestigationValidationError)
    expect(() => validateDepth(1.2)).toThrow(InvestigationValidationError)
  })

  it('rejects oversized relative paths', () => {
    expect(() => validateRelativePathInput('a'.repeat(600))).toThrow(InvestigationValidationError)
  })

  it('rejects oversized session ids', () => {
    expect(() => validateSessionId('x'.repeat(200))).toThrow(InvestigationValidationError)
  })

  it('does not let NaN bypass list limit in tool layer', () => {
    expect(() => resolveListLimit(Number.NaN)).toThrow(/无效的 limit/)
  })

  it('rejects depth on list_children and limit on summarize_directory', () => {
    expect(() => rejectUnexpectedDepth('list_children', 1)).toThrow(InvestigationValidationError)
    expect(() => rejectUnexpectedLimit('summarize_directory', 5)).toThrow(InvestigationValidationError)
  })
})
