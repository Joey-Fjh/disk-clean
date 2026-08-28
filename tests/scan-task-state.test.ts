import { describe, expect, it } from 'vitest'
import { resolveScanTaskHeadline, resolveScanTaskSubline } from '../src/renderer/scan-task-state'

describe('scan task state', () => {
  it('describes scanning and agent phases without fake percentages', () => {
    expect(
      resolveScanTaskHeadline({ phase: 'scanning', driveLabel: 'C: 盘', discoveredCount: 12 })
    ).toContain('正在扫描 C: 盘')
    expect(
      resolveScanTaskHeadline({ phase: 'organizing', driveLabel: 'C: 盘', discoveredCount: 320 })
    ).toContain('320')
    expect(
      resolveScanTaskHeadline({ phase: 'analyzing', driveLabel: 'C: 盘', discoveredCount: 320 })
    ).toContain('本地清理规则')
    expect(
      resolveScanTaskHeadline({
        phase: 'analyzing',
        driveLabel: 'C: 盘',
        discoveredCount: 320,
        agentCandidateCount: 5
      })
    ).toContain('5 个高占用位置')
    expect(
      resolveScanTaskHeadline({ phase: 'failed', driveLabel: 'C: 盘', discoveredCount: 1 })
    ).toContain('本地规则结果')
  })

  it('uses subline for updating results', () => {
    expect(
      resolveScanTaskSubline({
        phase: 'scanning',
        driveLabel: 'C: 盘',
        discoveredCount: 9,
        resultsUpdating: true
      })
    ).toBe('结果仍在更新…')
    expect(
      resolveScanTaskHeadline({ phase: 'scanning', driveLabel: 'C: 盘', discoveredCount: 9 })
    ).toContain('正在扫描')
  })

  it('describes executing and rescanning phases', () => {
    expect(
      resolveScanTaskHeadline({ phase: 'executing', driveLabel: 'C: 盘', discoveredCount: 12 })
    ).toContain('回收站')
    expect(
      resolveScanTaskSubline({ phase: 'executing', driveLabel: 'C: 盘', discoveredCount: 12 })
    ).toContain('请勿重复提交')
    expect(
      resolveScanTaskHeadline({ phase: 'rescanning', driveLabel: 'C: 盘', discoveredCount: 12 })
    ).toContain('复核')
  })
})
