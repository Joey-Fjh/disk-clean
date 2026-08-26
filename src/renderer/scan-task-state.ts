import type { AgentAnalysisStatus } from '../shared/agent-types'
import type { ScanPhase } from '../shared/types'

export type ScanTaskPhase =
  | 'idle'
  | 'scanning-disk'
  | 'organizing-local'
  | 'agent-reviewing'
  | 'completed'
  | 'agent-failed'
  | 'cancelled'

export interface ScanTaskStateInput {
  phase: ScanTaskPhase
  discoveredCount: number
  agentStatus?: AgentAnalysisStatus
}

export function resolveScanTaskHeadline(input: ScanTaskStateInput): string {
  switch (input.phase) {
    case 'scanning-disk':
      return '正在扫描磁盘'
    case 'organizing-local':
      return `已发现 ${input.discoveredCount} 项，正在根据本地规则整理`
    case 'agent-reviewing':
      return '本地识别完成，正在进行智能复核'
    case 'completed':
      return input.agentStatus === 'skipped_no_provider'
        ? '分析完成（未配置模型，已使用本地规则结果）'
        : '分析完成'
    case 'agent-failed':
      return '智能复核失败，已使用本地规则结果'
    case 'cancelled':
      return '扫描已停止，未运行智能复核'
    default:
      return '准备就绪'
  }
}

export function mapScanProgressPhaseToTaskPhase(
  scanning: boolean,
  scanPhase?: ScanPhase
): ScanTaskPhase {
  if (!scanning) return 'idle'
  if (scanPhase === 'rule-identification') return 'organizing-local'
  return 'scanning-disk'
}

export function resolveScanTaskSubline(input: ScanTaskStateInput): string {
  switch (input.phase) {
    case 'scanning-disk':
    case 'organizing-local':
      return input.discoveredCount > 0 ? `已发现 ${input.discoveredCount} 项` : ''
    case 'agent-reviewing':
      return '正在进行智能复核…'
    case 'agent-failed':
      return '已回退到本地规则结果'
    default:
      return ''
  }
}

export function isScanningJudgmentPending(status: string): boolean {
  return status === 'identifying' || status === 'pending'
}
