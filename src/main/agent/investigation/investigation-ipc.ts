import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import type { AgentErrorCode } from '../../../shared/agent-errors'
import { agentIpcFail, agentIpcOk } from '../../../shared/agent-ipc'
import { isInvestigationToolName } from '../../../shared/investigation-limits'
import {
  InvestigationValidationError,
  validateCandidateRef,
  validateDepth,
  validateListLimit,
  validateRelativePathInput,
  validateSampleLimit,
  validateSessionId
} from '../../../shared/investigation-request-validation'
import type { InvestigationToolRequest } from '../../../shared/investigation-types'
import { isTrustedMainWindowSender } from '../../window-security'
import { InvestigationError } from './investigation-errors'
import {
  cancelInvestigation,
  executeInvestigationTool,
  getInvestigationStatus,
  startInvestigation
} from './investigation-service'

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedMainWindowSender(event.sender)) {
    throw new InvestigationError('IPC_UNAUTHORIZED', '未授权的调查请求')
  }
}

function parseSessionPayload(input: unknown): { sessionId: string } {
  if (!input || typeof input !== 'object') {
    throw new InvestigationError('INVALID_INPUT', '无效请求')
  }
  const payload = input as Record<string, unknown>
  return { sessionId: validateSessionId(payload.sessionId) }
}

function parseOptionalNumber(
  value: unknown,
  label: 'limit' | 'depth',
  validate: (value: unknown) => number | undefined
): number | undefined {
  if (value === undefined || value === null) return undefined
  try {
    return validate(value)
  } catch (error) {
    if (error instanceof InvestigationValidationError) {
      throw new InvestigationError(error.code, error.message)
    }
    throw error
  }
}

function parseToolRequest(input: unknown): InvestigationToolRequest {
  if (!input || typeof input !== 'object') {
    throw new InvestigationError('INVALID_INPUT', '无效请求')
  }
  const payload = input as Record<string, unknown>
  const sessionId = validateSessionId(payload.sessionId)
  const candidateRef = validateCandidateRef(payload.candidateRef)
  if (typeof payload.toolName !== 'string' || !isInvestigationToolName(payload.toolName)) {
    throw new InvestigationError('TOOL_NOT_ALLOWED', '调查工具不可用')
  }

  let relativePath: string | undefined
  try {
    relativePath = validateRelativePathInput(payload.relativePath)
  } catch (error) {
    if (error instanceof InvestigationValidationError) {
      throw new InvestigationError(error.code, error.message)
    }
    throw error
  }

  const limit =
    payload.toolName === 'summarize_directory'
      ? payload.limit === undefined || payload.limit === null
        ? undefined
        : (() => {
            throw new InvestigationError('INVALID_INPUT', '无效的 limit')
          })()
      : parseOptionalNumber(payload.limit, 'limit', (value) =>
          payload.toolName === 'sample_entry_names' ? validateSampleLimit(value) : validateListLimit(value)
        )
  const depth =
    payload.toolName === 'summarize_directory'
      ? parseOptionalNumber(payload.depth, 'depth', validateDepth)
      : payload.depth === undefined || payload.depth === null
        ? undefined
        : (() => {
            throw new InvestigationError('INVALID_INPUT', '无效的 depth')
          })()

  return {
    sessionId,
    candidateRef,
    toolName: payload.toolName,
    relativePath,
    limit,
    depth
  }
}

function toIpcError(error: unknown) {
  if (error instanceof InvestigationError) {
    return agentIpcFail(error.code, error.message)
  }
  if (error instanceof InvestigationValidationError) {
    return agentIpcFail(error.code, error.message)
  }
  return agentIpcFail('INTERNAL_ERROR' satisfies AgentErrorCode, '调查失败')
}

export async function handleInvestigationStatus(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedSender(event)
    const { sessionId } = parseSessionPayload(input)
    const status = getInvestigationStatus(sessionId)
    if (!status) {
      return agentIpcFail('SESSION_STALE', '扫描会话已过期')
    }
    return agentIpcOk(status)
  } catch (error) {
    return toIpcError(error)
  }
}

export async function handleInvestigationCancel(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedSender(event)
    const { sessionId } = parseSessionPayload(input)
    const status = cancelInvestigation(sessionId)
    if (!status) {
      return agentIpcFail('SESSION_STALE', '扫描会话已过期')
    }
    return agentIpcOk(status)
  } catch (error) {
    return toIpcError(error)
  }
}

export async function handleInvestigationStart(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedSender(event)
    const { sessionId } = parseSessionPayload(input)
    return agentIpcOk(startInvestigation(sessionId))
  } catch (error) {
    return toIpcError(error)
  }
}

export async function handleInvestigationExecuteTool(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedSender(event)
    const request = parseToolRequest(input)
    return agentIpcOk(await executeInvestigationTool(request))
  } catch (error) {
    return toIpcError(error)
  }
}

export function registerInvestigationIpc(): void {
  ipcMain.handle('agent:investigation-status', (event, input) => handleInvestigationStatus(event, input))
  ipcMain.handle('agent:investigation-cancel', (event, input) => handleInvestigationCancel(event, input))
  ipcMain.handle('agent:investigation-start', (event, input) => handleInvestigationStart(event, input))
  ipcMain.handle('agent:investigation-execute-tool', (event, input) =>
    handleInvestigationExecuteTool(event, input)
  )
}
