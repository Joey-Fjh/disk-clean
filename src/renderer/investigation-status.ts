import type { InvestigationPhase } from '../shared/investigation-types'
import type { InvestigationTimelineEvent } from '../shared/investigation-timeline-types'

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

const TERMINAL_TIMELINE_TYPES = new Set<InvestigationTimelineEvent['type']>([
  'completed',
  'uncertain',
  'failed',
  'cancelled'
])

export function hasTerminalInvestigationTimelineEvent(
  events: InvestigationTimelineEvent[]
): boolean {
  return events.some((event) => TERMINAL_TIMELINE_TYPES.has(event.type))
}

export function resolveTimelineDisplayMessage(
  event: InvestigationTimelineEvent,
  hasTerminalEvent: boolean
): string {
  if (!hasTerminalEvent) return event.message

  switch (event.type) {
    case 'investigation_started':
      return event.message.replace(/^正在分析/, '已分析')
    case 'model_analyzing':
      return '已生成清理建议'
    case 'tool_requested':
      return event.message.replace(/^正在查看/, '已查看')
    case 'tool_completed':
      return event.message.replace(/^正在查看/, '已查看')
    case 'planning':
      return event.message.replace(/^正在生成/, '已生成')
    default:
      return event.message
  }
}
