import type { AgentErrorCode } from '../../shared/agent-errors'

export class AgentError extends Error {
  readonly code: AgentErrorCode

  constructor(code: AgentErrorCode, message: string) {
    super(message)
    this.name = 'AgentError'
    this.code = code
  }
}
