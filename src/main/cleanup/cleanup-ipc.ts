import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import type { CleanupExecuteRequest, CleanupPrepareRequest } from '../../shared/types'
import { cleanupIpcFail, cleanupIpcOk } from '../../shared/cleanup-ipc'
import { CLEANUP_ERROR_MESSAGES } from '../../shared/cleanup-errors'
import {
  MAX_CONFIRMATION_ID_LENGTH,
  MAX_FINGERPRINT_LENGTH,
  MAX_SESSION_ID_LENGTH
} from '../../shared/cleanup-limits'
import { isTrustedMainWindowSender } from '../window-security'
import { CleanupServiceError } from './cleanup-errors'
import { executeConfirmedCleanup, prepareCleanupConfirmation } from './cleanup-service'

const ALLOWED_PREPARE_KEYS = new Set(['sessionId', 'fingerprint', 'candidateIds'])
const ALLOWED_EXECUTE_KEYS = new Set(['confirmationId'])

function assertTrustedCleanupSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedMainWindowSender(event.sender)) {
    throw new CleanupServiceError('IPC_UNAUTHORIZED', CLEANUP_ERROR_MESSAGES.IPC_UNAUTHORIZED)
  }
}

function rejectUnknownFields(payload: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
    }
  }
}

function validatePrepareRequest(input: unknown): CleanupPrepareRequest {
  if (!input || typeof input !== 'object') {
    throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }
  const payload = input as Record<string, unknown>
  rejectUnknownFields(payload, ALLOWED_PREPARE_KEYS)
  if (typeof payload.sessionId !== 'string' || !payload.sessionId.trim()) {
    throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }
  if (payload.sessionId.trim().length > MAX_SESSION_ID_LENGTH) {
    throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }
  if (typeof payload.fingerprint !== 'string' || !payload.fingerprint.trim()) {
    throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }
  if (payload.fingerprint.trim().length > MAX_FINGERPRINT_LENGTH) {
    throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }
  if (!Array.isArray(payload.candidateIds) || payload.candidateIds.some((id) => typeof id !== 'string')) {
    throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }
  return {
    sessionId: payload.sessionId.trim(),
    fingerprint: payload.fingerprint.trim(),
    candidateIds: payload.candidateIds as string[]
  }
}

function validateExecuteRequest(input: unknown): CleanupExecuteRequest {
  if (!input || typeof input !== 'object') {
    throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }
  const payload = input as Record<string, unknown>
  rejectUnknownFields(payload, ALLOWED_EXECUTE_KEYS)
  if (typeof payload.confirmationId !== 'string' || !payload.confirmationId.trim()) {
    throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }
  if (payload.confirmationId.trim().length > MAX_CONFIRMATION_ID_LENGTH) {
    throw new CleanupServiceError('INVALID_INPUT', CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }
  return { confirmationId: payload.confirmationId.trim() }
}

function mapCleanupError(error: unknown) {
  if (error instanceof CleanupServiceError) {
    return cleanupIpcFail(error.code, error.message)
  }
  return cleanupIpcFail('INTERNAL_ERROR', CLEANUP_ERROR_MESSAGES.INTERNAL_ERROR)
}

export async function handleCleanupPrepare(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedCleanupSender(event)
    const request = validatePrepareRequest(input)
    return cleanupIpcOk(prepareCleanupConfirmation(request))
  } catch (error) {
    return mapCleanupError(error)
  }
}

export async function handleCleanupExecute(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedCleanupSender(event)
    const request = validateExecuteRequest(input)
    return cleanupIpcOk(await executeConfirmedCleanup(request.confirmationId))
  } catch (error) {
    return mapCleanupError(error)
  }
}

export function registerCleanupIpcHandlers(): void {
  ipcMain.handle('cleanup:prepare', handleCleanupPrepare)
  ipcMain.handle('cleanup:execute', handleCleanupExecute)
}
