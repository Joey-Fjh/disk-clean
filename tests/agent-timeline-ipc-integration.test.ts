// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createWebContentsTimelineSink } from '../src/main/agent/investigation/investigation-timeline-bus'
import {
  appendInvestigationTimelineEvent,
  beginInvestigationTimeline,
  getActiveTimelineGeneration,
  resetInvestigationTimeline
} from '../src/renderer/agent-investigation-timeline'
import type { InvestigationTimelineEvent } from '../src/shared/investigation-timeline-types'

describe('investigation timeline IPC integration', () => {
  it('delivers main-process events to renderer after generation binding', () => {
    document.body.innerHTML = `
      <div id="agent-investigation-timeline" hidden>
        <ul id="agent-investigation-timeline-list"></ul>
      </div>
    `
    resetInvestigationTimeline()
    beginInvestigationTimeline('session-ipc')

    const delivered: InvestigationTimelineEvent[] = []
    const sink = createWebContentsTimelineSink(
      {
        isDestroyed: () => false,
        send: (_channel: string, event: InvestigationTimelineEvent) => {
          delivered.push(event)
          appendInvestigationTimelineEvent(event)
        }
      } as never,
      () => true
    )

    const mainGeneration = 'main-authoritative-generation'
    sink({
      schemaVersion: 1,
      type: 'investigation_started',
      sessionId: 'session-ipc',
      generation: mainGeneration,
      at: Date.now(),
      message: '正在分析 3 个高占用位置'
    })
    sink({
      schemaVersion: 1,
      type: 'tool_requested',
      sessionId: 'session-ipc',
      generation: mainGeneration,
      at: Date.now(),
      message: '正在查看 candidate-2 的目录构成',
      candidateRef: 'candidate-2'
    })

    expect(delivered).toHaveLength(2)
    expect(getActiveTimelineGeneration()).toBe(mainGeneration)
    const list = document.getElementById('agent-investigation-timeline-list')!
    expect(list.children.length).toBe(2)
    expect(list.textContent).toContain('正在分析 3 个高占用位置')
    expect(list.textContent).toContain('candidate-2')
  })
})
