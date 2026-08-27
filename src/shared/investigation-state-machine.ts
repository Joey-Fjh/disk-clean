import type { InvestigationPhase } from './investigation-types'

const TERMINAL_PHASES = new Set<InvestigationPhase>([
  'completed',
  'uncertain',
  'failed',
  'cancelled',
  'stale'
])

export function isInvestigationTerminal(phase: InvestigationPhase): boolean {
  return TERMINAL_PHASES.has(phase)
}

export function canStartInvestigation(phase: InvestigationPhase): boolean {
  return phase === 'idle' || phase === 'completed' || phase === 'uncertain' || phase === 'failed' || phase === 'cancelled' || phase === 'stale'
}

export function transitionInvestigationPhase(
  current: InvestigationPhase,
  event:
    | 'start'
    | 'request_tool'
    | 'run_tool'
    | 'tool_done'
    | 'resume_analyzing'
    | 'complete'
    | 'uncertain'
    | 'fail'
    | 'cancel'
    | 'stale'
): InvestigationPhase {
  if (event === 'stale') return 'stale'
  if (event === 'cancel') {
    if (current === 'idle' || isInvestigationTerminal(current)) return current
    return 'cancelled'
  }

  switch (current) {
    case 'idle':
    case 'completed':
    case 'uncertain':
    case 'failed':
    case 'cancelled':
    case 'stale':
      if (event === 'start') return 'analyzing'
      return current
    case 'analyzing':
      if (event === 'request_tool') return 'tool_requested'
      if (event === 'complete') return 'completed'
      if (event === 'uncertain') return 'uncertain'
      if (event === 'fail') return 'failed'
      return current
    case 'tool_requested':
      if (event === 'run_tool') return 'tool_running'
      if (event === 'uncertain') return 'uncertain'
      if (event === 'fail') return 'failed'
      return current
    case 'tool_running':
      if (event === 'tool_done') return 'analyzing_result'
      if (event === 'uncertain') return 'uncertain'
      if (event === 'fail') return 'failed'
      return current
    case 'analyzing_result':
      if (event === 'resume_analyzing') return 'analyzing'
      if (event === 'complete') return 'completed'
      if (event === 'uncertain') return 'uncertain'
      if (event === 'fail') return 'failed'
      return current
    default:
      return current
  }
}
