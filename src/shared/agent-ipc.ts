import type { AgentErrorCode } from './agent-errors'
import type { AgentAnalyzeResult } from './agent-types'

export type AgentIpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: AgentErrorCode; message: string }

export function agentIpcOk<T>(value: T): AgentIpcResult<T> {
  return { ok: true, value }
}

export function agentIpcFail(code: AgentErrorCode, message: string): AgentIpcResult<never> {
  return { ok: false, code, message }
}

export type AgentAnalyzeIpcResult = AgentIpcResult<AgentAnalyzeResult>
