// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { resolveTaskHeadline, runPlanningPhase } from '../src/renderer/cleanup-task-ui'

describe('cleanup task ui', () => {
  it('shows agent candidate count in analyzing headline', () => {
    expect(
      resolveTaskHeadline({
        phase: 'analyzing',
        driveLabel: 'C: 盘',
        discoveredCount: 320,
        agentCandidateCount: 8,
        agentStatus: 'running'
      })
    ).toContain('8 个高占用位置')
  })

  it('runs planning phase across at least one animation frame', async () => {
    const frames: Array<() => void> = []
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        frames.push(cb as () => void)
        return frames.length
      })

    const phases: string[] = []
    const refresh = vi.fn()
    const promise = runPlanningPhase((phase) => phases.push(phase), refresh)
    expect(phases).toEqual(['planning'])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(frames.length).toBe(1)
    frames[0]?.()
    await promise
    raf.mockRestore()
  })
})
