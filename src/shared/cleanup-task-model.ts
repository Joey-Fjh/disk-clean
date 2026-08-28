import type { AgentAnalysisStatus } from './agent-types'
import type { ScanPhase } from './types'

/** 一次完整电脑清理任务的阶段。 */
export type CleanupTaskPhase =
  | 'idle'
  | 'scanning'
  | 'organizing'
  | 'analyzing'
  | 'planning'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface CleanupTaskProgressInput {
  phase: CleanupTaskPhase
  driveLabel: string
  discoveredCount: number
  agentStatus?: AgentAnalysisStatus
  agentCandidateCount?: number
  resultsUpdating?: boolean
}

export function mapScanPhaseToCleanupTaskPhase(
  scanning: boolean,
  scanPhase?: ScanPhase,
  agentReviewing?: boolean,
  planning?: boolean
): CleanupTaskPhase {
  if (!scanning && !agentReviewing && !planning) return 'idle'
  if (planning) return 'planning'
  if (agentReviewing) return 'analyzing'
  if (scanPhase === 'rule-identification') return 'organizing'
  if (scanning) return 'scanning'
  return 'idle'
}

export function resolveCleanupTaskHeadline(input: CleanupTaskProgressInput): string {
  switch (input.phase) {
    case 'scanning':
      return `正在扫描 ${input.driveLabel}`
    case 'organizing':
      return `已扫描 ${input.discoveredCount.toLocaleString()} 个项目，正在整理空间占用`
    case 'analyzing':
      if (input.agentCandidateCount && input.agentCandidateCount > 0) {
        return `Agent 正在分析 ${input.agentCandidateCount} 个高占用位置`
      }
      return '正在应用本地清理规则'
    case 'planning':
      return '正在生成清理建议'
    case 'completed':
      if (input.agentStatus === 'cancelled') {
        return '本地分析完成，智能复核已停止'
      }
      if (input.agentStatus === 'skipped_no_provider') {
        return '分析完成（未配置模型，已使用本地规则结果）'
      }
      return '分析完成'
    case 'failed':
      return '智能复核失败，已保留本地规则结果'
    case 'cancelled':
      return '扫描已停止'
    default:
      return '准备就绪'
  }
}

export function resolveCleanupTaskSubline(input: CleanupTaskProgressInput): string {
  if (input.resultsUpdating) {
    return '结果仍在更新…'
  }
  switch (input.phase) {
    case 'organizing':
      return '正在应用本地清理规则'
    case 'analyzing':
      return input.agentStatus === 'running' ? '正在进行智能复核…' : ''
    case 'failed':
      return '本地规则结果仍可使用'
    case 'completed':
      if (input.agentStatus === 'cancelled') {
        return '本地规则建议仍可使用'
      }
      return ''
    case 'cancelled':
      return '未运行智能复核'
    default:
      return ''
  }
}

export function isCleanupTaskInProgress(phase: CleanupTaskPhase): boolean {
  return phase === 'scanning' || phase === 'organizing' || phase === 'analyzing' || phase === 'planning'
}
