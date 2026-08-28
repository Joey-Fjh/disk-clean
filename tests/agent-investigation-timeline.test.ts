// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  appendInvestigationTimelineEvent,
  beginInvestigationTimeline,
  getActiveTimelineGeneration,
  mergeInvestigationTimelineFromResult,
  resetInvestigationTimeline
} from '../src/renderer/agent-investigation-timeline'
import { MAX_INVESTIGATION_TIMELINE_ENTRIES } from '../src/shared/investigation-timeline-types'

describe('agent investigation timeline renderer', () => {
  it('renders with textContent-safe messages and caps entries', () => {
    document.body.innerHTML = `
      <div id="agent-investigation-timeline" hidden>
        <ul id="agent-investigation-timeline-list"></ul>
      </div>
    `
    resetInvestigationTimeline()
    beginInvestigationTimeline('session-1')
    appendInvestigationTimelineEvent({
      schemaVersion: 1,
      type: 'investigation_started',
      sessionId: 'session-1',
      generation: 'main-gen-authoritative',
      at: Date.now(),
      message: '开始分析'
    })

    for (let i = 0; i < MAX_INVESTIGATION_TIMELINE_ENTRIES + 5; i += 1) {
      appendInvestigationTimelineEvent({
        schemaVersion: 1,
        type: 'tool_completed',
        sessionId: 'session-1',
        generation: 'main-gen-authoritative',
        at: Date.now(),
        message: `<img src=x onerror=alert(${i})>条目 ${i}`
      })
    }

    const list = document.getElementById('agent-investigation-timeline-list')!
    expect(list.children.length).toBeLessThanOrEqual(MAX_INVESTIGATION_TIMELINE_ENTRIES)
    expect(list.innerHTML).not.toContain('<img')
    expect(list.textContent).toContain('条目')
    expect(getActiveTimelineGeneration()).toBe('main-gen-authoritative')
  })

  it('merges IPC result timeline when generation matches bound value', () => {
    document.body.innerHTML = `
      <div id="agent-investigation-timeline" hidden>
        <ul id="agent-investigation-timeline-list"></ul>
      </div>
    `
    resetInvestigationTimeline()
    beginInvestigationTimeline('session-1')
    appendInvestigationTimelineEvent({
      schemaVersion: 1,
      type: 'investigation_started',
      sessionId: 'session-1',
      generation: 'ipc-gen',
      at: Date.now(),
      message: '开始'
    })

    mergeInvestigationTimelineFromResult('session-1', 'ipc-gen', [
      {
        schemaVersion: 1,
        type: 'investigation_started',
        sessionId: 'session-1',
        generation: 'ipc-gen',
        at: Date.now(),
        message: '开始'
      },
      {
        schemaVersion: 1,
        type: 'completed',
        sessionId: 'session-1',
        generation: 'ipc-gen',
        at: Date.now(),
        message: '调查完成'
      }
    ])

    const list = document.getElementById('agent-investigation-timeline-list')!
    expect(list.children.length).toBe(2)
    expect(list.textContent).toContain('调查完成')
  })

  it('only binds generation from investigation_started and ignores stale pre-bind events', () => {
    document.body.innerHTML = `
      <div id="agent-investigation-timeline" hidden>
        <ul id="agent-investigation-timeline-list"></ul>
      </div>
    `
    resetInvestigationTimeline()
    beginInvestigationTimeline('session-1')

    appendInvestigationTimelineEvent({
      schemaVersion: 1,
      type: 'tool_completed',
      sessionId: 'session-1',
      generation: 'stale-gen',
      at: Date.now(),
      message: '旧工具事件'
    })
    expect(getActiveTimelineGeneration()).toBeNull()

    appendInvestigationTimelineEvent({
      schemaVersion: 1,
      type: 'investigation_started',
      sessionId: 'session-1',
      generation: 'main-gen',
      at: Date.now(),
      message: '正在分析'
    })
    expect(getActiveTimelineGeneration()).toBe('main-gen')

    appendInvestigationTimelineEvent({
      schemaVersion: 1,
      type: 'model_analyzing',
      sessionId: 'session-1',
      generation: 'stale-gen',
      at: Date.now(),
      message: '旧事件'
    })
    const list = document.getElementById('agent-investigation-timeline-list')!
    expect(list.children.length).toBe(1)
  })

  it('renders completed timeline steps in past tense', () => {
    document.body.innerHTML = `
      <div id="agent-investigation-timeline" hidden>
        <ul id="agent-investigation-timeline-list"></ul>
      </div>
    `
    resetInvestigationTimeline()
    beginInvestigationTimeline('session-1')
    const generation = 'done-gen'
    mergeInvestigationTimelineFromResult('session-1', generation, [
      {
        schemaVersion: 1,
        type: 'investigation_started',
        sessionId: 'session-1',
        generation,
        at: 1,
        message: '正在分析 3 个高占用位置'
      },
      {
        schemaVersion: 1,
        type: 'model_analyzing',
        sessionId: 'session-1',
        generation,
        at: 2,
        message: '正在生成清理建议'
      },
      {
        schemaVersion: 1,
        type: 'completed',
        sessionId: 'session-1',
        generation,
        at: 3,
        message: '调查完成'
      }
    ])

    const list = document.getElementById('agent-investigation-timeline-list')!
    expect(list.textContent).toContain('已分析 3 个高占用位置')
    expect(list.textContent).toContain('已生成清理建议')
    expect(list.textContent).toContain('调查完成')
    expect(list.textContent).not.toContain('正在生成清理建议')
  })

  it('replaces live timeline with authoritative snapshot without duplicates', () => {
    document.body.innerHTML = `
      <div id="agent-investigation-timeline" hidden>
        <ul id="agent-investigation-timeline-list"></ul>
      </div>
    `
    resetInvestigationTimeline()
    beginInvestigationTimeline('session-1')
    const at = Date.now()

    appendInvestigationTimelineEvent({
      schemaVersion: 1,
      type: 'investigation_started',
      sessionId: 'session-1',
      generation: 'ipc-gen',
      at,
      message: '开始'
    })
    appendInvestigationTimelineEvent({
      schemaVersion: 1,
      type: 'tool_completed',
      sessionId: 'session-1',
      generation: 'ipc-gen',
      at: at + 1,
      message: '工具完成'
    })

    mergeInvestigationTimelineFromResult('session-1', 'ipc-gen', [
      {
        schemaVersion: 1,
        type: 'investigation_started',
        sessionId: 'session-1',
        generation: 'ipc-gen',
        at,
        message: '开始'
      },
      {
        schemaVersion: 1,
        type: 'tool_completed',
        sessionId: 'session-1',
        generation: 'ipc-gen',
        at: at + 1,
        message: '工具完成'
      },
      {
        schemaVersion: 1,
        type: 'completed',
        sessionId: 'session-1',
        generation: 'ipc-gen',
        at: at + 2,
        message: '调查完成'
      }
    ])

    const list = document.getElementById('agent-investigation-timeline-list')!
    expect(list.children.length).toBe(3)
    expect(list.textContent).toContain('调查完成')
  })

  it('binds generation from authoritative IPC snapshot without investigation_started', () => {
    document.body.innerHTML = `
      <div id="agent-investigation-timeline" hidden>
        <ul id="agent-investigation-timeline-list"></ul>
      </div>
    `
    resetInvestigationTimeline()
    beginInvestigationTimeline('session-1')

    const generation = 'authoritative-gen'
    const timeline = Array.from({ length: MAX_INVESTIGATION_TIMELINE_ENTRIES + 10 }, (_, index) => ({
      schemaVersion: 1 as const,
      type: 'tool_completed' as const,
      sessionId: 'session-1',
      generation,
      at: index,
      message: `步骤 ${index}`
    }))
    timeline.push({
      schemaVersion: 1,
      type: 'completed',
      sessionId: 'session-1',
      generation,
      at: timeline.length,
      message: '调查完成'
    })

    mergeInvestigationTimelineFromResult('session-1', generation, timeline)

    expect(getActiveTimelineGeneration()).toBe(generation)
    const list = document.getElementById('agent-investigation-timeline-list')!
    expect(list.children.length).toBe(MAX_INVESTIGATION_TIMELINE_ENTRIES)
    expect(list.textContent).toContain('调查完成')
  })

  it('rejects authoritative merge for other sessions or mismatched generation', () => {
    document.body.innerHTML = `
      <div id="agent-investigation-timeline" hidden>
        <ul id="agent-investigation-timeline-list"></ul>
      </div>
    `
    resetInvestigationTimeline()
    beginInvestigationTimeline('session-1')
    appendInvestigationTimelineEvent({
      schemaVersion: 1,
      type: 'investigation_started',
      sessionId: 'session-1',
      generation: 'bound-gen',
      at: Date.now(),
      message: '开始'
    })

    mergeInvestigationTimelineFromResult('session-2', 'bound-gen', [
      {
        schemaVersion: 1,
        type: 'completed',
        sessionId: 'session-2',
        generation: 'bound-gen',
        at: Date.now(),
        message: '其他会话'
      }
    ])
    mergeInvestigationTimelineFromResult('session-1', 'other-gen', [
      {
        schemaVersion: 1,
        type: 'completed',
        sessionId: 'session-1',
        generation: 'other-gen',
        at: Date.now(),
        message: '其他 generation'
      }
    ])

    const list = document.getElementById('agent-investigation-timeline-list')!
    expect(list.children.length).toBe(1)
    expect(list.textContent).toBe('开始')
    expect(getActiveTimelineGeneration()).toBe('bound-gen')
  })
})
