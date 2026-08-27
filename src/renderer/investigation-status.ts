import type { InvestigationPhase } from '../shared/investigation-types'

export type InvestigationUiLabel =
  | '正在分析'
  | '正在调查'
  | '已取消'
  | '无法确定'
  | '调查失败，本地结果仍可使用'
  | '调查完成'
  | '空闲'

export function resolveInvestigationUiLabel(phase: InvestigationPhase): InvestigationUiLabel {
  switch (phase) {
    case 'analyzing':
    case 'analyzing_result':
      return '正在分析'
    case 'tool_requested':
    case 'tool_running':
      return '正在调查'
    case 'cancelled':
      return '已取消'
    case 'uncertain':
      return '无法确定'
    case 'failed':
      return '调查失败，本地结果仍可使用'
    case 'completed':
      return '调查完成'
    default:
      return '空闲'
  }
}
