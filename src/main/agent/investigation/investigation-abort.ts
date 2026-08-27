import { InvestigationError, investigationErrorMessage } from './investigation-errors'

export type InvestigationAbortReason =
  | 'user-cancel'
  | 'tool-timeout'
  | 'investigation-timeout'
  | 'session-stale'

export function throwIfAborted(
  signal: AbortSignal | undefined,
  resolveReason: () => InvestigationAbortReason | null
): void {
  if (!signal?.aborted) return
  const reason = resolveReason() ?? 'user-cancel'
  if (reason === 'tool-timeout' || reason === 'investigation-timeout') {
    throw new InvestigationError('TIMEOUT', investigationErrorMessage('TIMEOUT'))
  }
  if (reason === 'session-stale') {
    throw new InvestigationError('SESSION_STALE', investigationErrorMessage('SESSION_STALE'))
  }
  throw new InvestigationError('CANCELLED', investigationErrorMessage('CANCELLED'))
}
