import { describe, expect, it } from 'vitest'
import { resolveScanTaskHeadline, resolveScanTaskSubline } from '../src/renderer/scan-task-state'

describe('scan task state', () => {
  it('describes scanning and agent phases without fake percentages', () => {
    expect(
      resolveScanTaskHeadline({ phase: 'scanning-disk', discoveredCount: 12 })
    ).toContain('正在扫描磁盘')
    expect(
      resolveScanTaskHeadline({ phase: 'organizing-local', discoveredCount: 320 })
    ).toContain('320')
    expect(resolveScanTaskHeadline({ phase: 'agent-reviewing', discoveredCount: 320 })).toContain(
      '智能复核'
    )
    expect(resolveScanTaskHeadline({ phase: 'agent-failed', discoveredCount: 1 })).toContain(
      '本地规则结果'
    )
  })

  it('uses subline for discovered counts without repeating the headline', () => {
    expect(
      resolveScanTaskSubline({ phase: 'scanning-disk', discoveredCount: 9 })
    ).toBe('已发现 9 项')
    expect(resolveScanTaskHeadline({ phase: 'scanning-disk', discoveredCount: 9 })).toBe(
      '正在扫描磁盘'
    )
  })
})
