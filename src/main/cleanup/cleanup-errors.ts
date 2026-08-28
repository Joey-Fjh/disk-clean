import type { CleanupErrorCode } from '../../shared/cleanup-errors'

export class CleanupServiceError extends Error {
  readonly code: CleanupErrorCode

  constructor(code: CleanupErrorCode, message: string) {
    super(message)
    this.name = 'CleanupServiceError'
    this.code = code
  }
}
