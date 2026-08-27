import { INVESTIGATION_LIMITS } from '../../../shared/investigation-limits'
import { InvestigationError } from './investigation-errors'

export function resolveListLimit(limit?: number): number {
  const value = limit ?? INVESTIGATION_LIMITS.MAX_ENTRIES_PER_CALL
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > INVESTIGATION_LIMITS.MAX_ENTRIES_PER_CALL) {
    throw new InvestigationError('INVALID_INPUT', '无效的 limit')
  }
  return value
}

export function resolveSampleLimit(limit?: number): number {
  const value = limit ?? INVESTIGATION_LIMITS.MAX_SAMPLE_NAMES
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > INVESTIGATION_LIMITS.MAX_SAMPLE_NAMES) {
    throw new InvestigationError('INVALID_INPUT', '无效的 limit')
  }
  return value
}

export function resolveDirectoryDepth(depth?: number): number {
  const value = depth ?? INVESTIGATION_LIMITS.MAX_DIRECTORY_DEPTH
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > INVESTIGATION_LIMITS.MAX_DIRECTORY_DEPTH) {
    throw new InvestigationError('INVALID_INPUT', '无效的 depth')
  }
  return value
}
