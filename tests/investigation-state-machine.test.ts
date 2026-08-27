import { describe, expect, it } from 'vitest'
import { transitionInvestigationPhase } from '../src/shared/investigation-state-machine'

describe('investigation state machine', () => {
  it('moves from idle to analyzing on start', () => {
    expect(transitionInvestigationPhase('idle', 'start')).toBe('analyzing')
  })

  it('moves through tool request lifecycle', () => {
    expect(transitionInvestigationPhase('analyzing', 'request_tool')).toBe('tool_requested')
    expect(transitionInvestigationPhase('tool_requested', 'run_tool')).toBe('tool_running')
    expect(transitionInvestigationPhase('tool_running', 'tool_done')).toBe('analyzing_result')
    expect(transitionInvestigationPhase('analyzing_result', 'resume_analyzing')).toBe('analyzing')
  })

  it('marks stale and cancelled from active phases', () => {
    expect(transitionInvestigationPhase('tool_running', 'stale')).toBe('stale')
    expect(transitionInvestigationPhase('analyzing', 'cancel')).toBe('cancelled')
  })
})
