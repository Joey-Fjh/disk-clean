import type { AgentAnalysisStatus } from '../shared/agent-types'
import type { CleanupTaskPhase, CleanupTaskProgressInput } from '../shared/cleanup-task-model'
import {
  resolveCleanupTaskHeadline,
  resolveCleanupTaskSubline
} from '../shared/cleanup-task-model'

export interface TaskProgressContext {
  phase: CleanupTaskPhase
  driveLabel: string
  discoveredCount: number
  agentStatus?: AgentAnalysisStatus
  agentCandidateCount?: number
  resultsUpdating?: boolean
}

export function buildTaskProgressContext(input: TaskProgressContext): CleanupTaskProgressInput {
  return {
    phase: input.phase,
    driveLabel: input.driveLabel,
    discoveredCount: input.discoveredCount,
    agentStatus: input.agentStatus,
    agentCandidateCount: input.agentCandidateCount,
    resultsUpdating: input.resultsUpdating
  }
}

export function resolveTaskHeadline(input: TaskProgressContext): string {
  return resolveCleanupTaskHeadline(buildTaskProgressContext(input))
}

export function resolveTaskSubline(input: TaskProgressContext): string {
  return resolveCleanupTaskSubline(buildTaskProgressContext(input))
}

export async function runPlanningPhase(
  applyPhase: (phase: CleanupTaskPhase) => void,
  refresh: () => void
): Promise<void> {
  applyPhase('planning')
  refresh()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}
