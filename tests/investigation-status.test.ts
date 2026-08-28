import { describe, expect, it } from 'vitest'
import {
  resolveInvestigationUiLabel,
  resolveTimelineDisplayMessage
} from '../src/renderer/investigation-status'

describe('investigation ui labels', () => {
  it('maps phases to minimal user-facing labels', () => {
    expect(resolveInvestigationUiLabel('tool_running')).toBe('正在调查')
    expect(resolveInvestigationUiLabel('cancelled')).toBe('已取消')
    expect(resolveInvestigationUiLabel('failed')).toBe('调查失败，本地结果仍可使用')
  })

  it('uses past tense for timeline messages after investigation completes', () => {
    const started = {
      schemaVersion: 1 as const,
      type: 'investigation_started' as const,
      sessionId: 's1',
      generation: 'g1',
      at: 1,
      message: '正在分析 3 个高占用位置'
    }
    const analyzing = {
      schemaVersion: 1 as const,
      type: 'model_analyzing' as const,
      sessionId: 's1',
      generation: 'g1',
      at: 2,
      message: '正在生成清理建议'
    }

    expect(resolveTimelineDisplayMessage(started, false)).toBe('正在分析 3 个高占用位置')
    expect(resolveTimelineDisplayMessage(analyzing, false)).toBe('正在生成清理建议')
    expect(resolveTimelineDisplayMessage(started, true)).toBe('已分析 3 个高占用位置')
    expect(resolveTimelineDisplayMessage(analyzing, true)).toBe('已生成清理建议')
  })
})
