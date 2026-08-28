import type { CleanupErrorCode } from './cleanup-errors'
import type { CleanupPlanPreview, CleanupResult } from './types'

export type CleanupIpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: CleanupErrorCode; message: string }

export function cleanupIpcOk<T>(value: T): CleanupIpcResult<T> {
  return { ok: true, value }
}

export function cleanupIpcFail(code: CleanupErrorCode, message: string): CleanupIpcResult<never> {
  return { ok: false, code, message }
}

export type CleanupPrepareIpcResult = CleanupIpcResult<CleanupPlanPreview>
export type CleanupExecuteIpcResult = CleanupIpcResult<CleanupResult>
