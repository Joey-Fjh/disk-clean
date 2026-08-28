import { describe, expect, it } from 'vitest'
import {
  resolveCleanupTaskHeadline,
  resolveCleanupTaskSubline,
  mapScanPhaseToCleanupTaskPhase
} from '../src/shared/cleanup-task-model'

describe('cleanup task model', () => {
  it('describes unified scan phases', () => {
    expect(
      resolveCleanupTaskHeadline({
        phase: 'scanning',
        driveLabel: 'C: 盘',
        discoveredCount: 12
      })
    ).toContain('正在扫描 C: 盘')
    expect(
      resolveCleanupTaskHeadline({
        phase: 'organizing',
        driveLabel: 'C: 盘',
        discoveredCount: 320
      })
    ).toContain('320')
    expect(
      resolveCleanupTaskHeadline({
        phase: 'analyzing',
        driveLabel: 'C: 盘',
        discoveredCount: 8,
        agentCandidateCount: 8
      })
    ).toContain('8 个高占用位置')
    expect(
      resolveCleanupTaskHeadline({
        phase: 'failed',
        driveLabel: 'C: 盘',
        discoveredCount: 1
      })
    ).toContain('本地规则结果')
  })

  it('describes agent-cancelled review as completed local analysis', () => {
    expect(
      resolveCleanupTaskHeadline({
        phase: 'completed',
        driveLabel: 'C: 盘',
        discoveredCount: 12,
        agentStatus: 'cancelled'
      })
    ).toBe('本地分析完成，智能复核已停止')
    expect(
      resolveCleanupTaskSubline({
        phase: 'completed',
        driveLabel: 'C: 盘',
        discoveredCount: 12,
        agentStatus: 'cancelled'
      })
    ).toContain('本地规则建议仍可使用')
  })

  it('uses subline for in-progress results', () => {
    expect(
      resolveCleanupTaskSubline({
        phase: 'scanning',
        driveLabel: 'C: 盘',
        discoveredCount: 9,
        resultsUpdating: true
      })
    ).toBe('结果仍在更新…')
  })

  it('maps scan phases to cleanup task phases', () => {
    expect(mapScanPhaseToCleanupTaskPhase(true, 'space-discovery')).toBe('scanning')
    expect(mapScanPhaseToCleanupTaskPhase(true, 'rule-identification')).toBe('organizing')
    expect(mapScanPhaseToCleanupTaskPhase(false, undefined, true)).toBe('analyzing')
  })
})
