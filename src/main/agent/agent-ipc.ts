import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import type { AgentAnalyzeRequest } from '../../shared/agent-types'
import { agentIpcFail, agentIpcOk } from '../../shared/agent-ipc'
import { isTrustedMainWindowSender } from '../window-security'
import { AgentError } from './agent-errors'
import { cancelAgentAnalysis, runAgentAnalysis } from './agent-service'

function assertTrustedAgentSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedMainWindowSender(event.sender)) {
    throw new AgentError('IPC_UNAUTHORIZED', '未授权的 Agent 请求')
  }
}

function validateAnalyzeRequest(input: unknown): AgentAnalyzeRequest {
  if (!input || typeof input !== 'object') {
    throw new AgentError('INVALID_INPUT', '无效的分析请求')
  }
  const payload = input as Record<string, unknown>
  if (typeof payload.sessionId !== 'string' || !payload.sessionId.trim()) {
    throw new AgentError('INVALID_INPUT', '无效的扫描会话')
  }
  if (
    payload.retry !== undefined &&
    payload.retry !== null &&
    typeof payload.retry !== 'boolean'
  ) {
    throw new AgentError('INVALID_INPUT', '无效的分析请求')
  }
  return {
    sessionId: payload.sessionId.trim(),
    retry: payload.retry === true
  }
}

export async function handleAgentAnalyze(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedAgentSender(event)
    const request = validateAnalyzeRequest(input)
    return agentIpcOk(
      await runAgentAnalysis(request, {
        webContents: event.sender,
        isTrustedSender: () => isTrustedMainWindowSender(event.sender)
      })
    )
  } catch (error) {
    if (error instanceof AgentError) {
      return agentIpcFail(error.code, error.message)
    }
    return agentIpcFail('INTERNAL_ERROR', '智能分析失败')
  }
}

export async function handleAgentCancel(event: IpcMainInvokeEvent) {
  try {
    assertTrustedAgentSender(event)
    cancelAgentAnalysis()
    return agentIpcOk(true)
  } catch (error) {
    if (error instanceof AgentError) {
      return agentIpcFail(error.code, error.message)
    }
    return agentIpcFail('INTERNAL_ERROR', '取消失败')
  }
}

export function registerAgentIpc(): void {
  ipcMain.handle('agent:analyze', (event, input: unknown) => handleAgentAnalyze(event, input))
  ipcMain.handle('agent:cancel-analysis', (event) => handleAgentCancel(event))
}
