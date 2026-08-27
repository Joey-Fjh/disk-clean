import { describe, expect, it } from 'vitest'
import { InvestigationBudget } from '../src/main/agent/investigation/investigation-budget'
import { INVESTIGATION_LIMITS } from '../src/shared/investigation-limits'

describe('investigation budget', () => {
  it('enforces per-round and total tool call limits', () => {
    const budget = new InvestigationBudget()
    budget.beginRound()
    for (let i = 0; i < INVESTIGATION_LIMITS.MAX_TOOL_CALLS_PER_ROUND; i += 1) {
      budget.reserveToolCall()
    }
    expect(() => budget.reserveToolCall()).toThrow(/本轮/)
  })

  it('enforces total response bytes', () => {
    const budget = new InvestigationBudget()
    expect(() => budget.recordResponseBytes(INVESTIGATION_LIMITS.MAX_TOTAL_RESPONSE_BYTES + 1)).toThrow(
      /累计响应/
    )
  })
})
