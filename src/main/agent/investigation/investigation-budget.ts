import { INVESTIGATION_LIMITS } from '../../../shared/investigation-limits'
import type { InvestigationBudgetSnapshot } from '../../../shared/investigation-types'
import { InvestigationError } from './investigation-errors'

export class InvestigationBudget {
  rounds = 0
  toolCallsThisRound = 0
  totalToolCalls = 0
  totalResponseBytes = 0

  snapshot(): InvestigationBudgetSnapshot {
    return {
      rounds: this.rounds,
      toolCallsThisRound: this.toolCallsThisRound,
      totalToolCalls: this.totalToolCalls,
      totalResponseBytes: this.totalResponseBytes
    }
  }

  beginRound(): void {
    if (this.rounds >= INVESTIGATION_LIMITS.MAX_ROUNDS) {
      throw new InvestigationError('TOOL_LIMIT_EXCEEDED', '调查轮次已达上限')
    }
    this.rounds += 1
    this.toolCallsThisRound = 0
  }

  reserveToolCall(): void {
    if (this.toolCallsThisRound >= INVESTIGATION_LIMITS.MAX_TOOL_CALLS_PER_ROUND) {
      throw new InvestigationError('TOOL_LIMIT_EXCEEDED', '本轮工具调用已达上限')
    }
    if (this.totalToolCalls >= INVESTIGATION_LIMITS.MAX_TOTAL_TOOL_CALLS) {
      throw new InvestigationError('TOOL_LIMIT_EXCEEDED', '调查工具调用已达上限')
    }
    this.toolCallsThisRound += 1
    this.totalToolCalls += 1
  }

  recordResponseBytes(bytes: number): void {
    this.totalResponseBytes += bytes
    if (this.totalResponseBytes > INVESTIGATION_LIMITS.MAX_TOTAL_RESPONSE_BYTES) {
      throw new InvestigationError('RESPONSE_TOO_LARGE', '调查累计响应过大')
    }
  }
}
