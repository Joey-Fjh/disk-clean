import {
  MAX_INVESTIGATION_TIMELINE_ENTRIES,
  type InvestigationTimelineEvent
} from '../shared/investigation-timeline-types'
import {
  hasTerminalInvestigationTimelineEvent,
  resolveTimelineDisplayMessage
} from './investigation-status'

let activeGeneration: string | null = null
let activeSessionId: string | null = null
const events: InvestigationTimelineEvent[] = []

const timelineEl = () => document.getElementById('agent-investigation-timeline') as HTMLElement | null
const timelineListEl = () =>
  document.getElementById('agent-investigation-timeline-list') as HTMLUListElement | null

function renderTimeline(): void {
  const container = timelineEl()
  const list = timelineListEl()
  if (!container || !list) return
  container.hidden = events.length === 0
  list.replaceChildren()
  const hasTerminalEvent = hasTerminalInvestigationTimelineEvent(events)
  for (const event of events) {
    const li = document.createElement('li')
    li.className = `agent-timeline-item agent-timeline-${event.type}`
    li.textContent = resolveTimelineDisplayMessage(event, hasTerminalEvent)
    list.appendChild(li)
  }
}

export function resetInvestigationTimeline(): void {
  activeGeneration = null
  activeSessionId = null
  events.length = 0
  const container = timelineEl()
  if (container) container.hidden = true
  const list = timelineListEl()
  if (list) list.replaceChildren()
}

/** 开始监听时间线；generation 由主进程事件权威绑定。 */
export function beginInvestigationTimeline(sessionId: string): void {
  activeSessionId = sessionId
  activeGeneration = null
  events.length = 0
  renderTimeline()
}

function bindGenerationIfNeeded(event: InvestigationTimelineEvent): boolean {
  if (activeGeneration !== null && activeGeneration !== event.generation) {
    return false
  }
  if (activeGeneration === null) {
    if (event.type !== 'investigation_started') {
      return false
    }
    activeGeneration = event.generation
  }
  return true
}

function timelineEventKey(event: InvestigationTimelineEvent): string {
  return [
    event.type,
    event.at,
    event.message,
    event.candidateRef ?? '',
    event.tool ?? ''
  ].join('|')
}


export function getActiveTimelineGeneration(): string | null {
  return activeGeneration
}

function upsertTimelineEvent(event: InvestigationTimelineEvent): void {
  const key = timelineEventKey(event)
  const existingIndex = events.findIndex((entry) => timelineEventKey(entry) === key)
  if (existingIndex >= 0) {
    events[existingIndex] = event
    return
  }
  if (events.length >= MAX_INVESTIGATION_TIMELINE_ENTRIES) {
    events.shift()
  }
  events.push(event)
}

export function appendInvestigationTimelineEvent(event: InvestigationTimelineEvent): boolean {
  if (activeSessionId !== event.sessionId) return false
  if (!bindGenerationIfNeeded(event)) return false
  upsertTimelineEvent(event)
  renderTimeline()
  return true
}

function bindAuthoritativeResultGeneration(generation: string): boolean {
  if (activeGeneration !== null && activeGeneration !== generation) {
    return false
  }
  if (activeGeneration === null) {
    activeGeneration = generation
  }
  return true
}

export function mergeInvestigationTimelineFromResult(
  sessionId: string,
  generation: string | undefined,
  timeline: InvestigationTimelineEvent[] | undefined
): void {
  if (!timeline?.length || !generation) return
  if (activeSessionId !== sessionId) return
  if (!bindAuthoritativeResultGeneration(generation)) return

  events.length = 0
  for (const event of timeline) {
    if (event.generation !== generation) continue
    upsertTimelineEvent(event)
  }
  renderTimeline()
}

export function wireInvestigationTimelineSubscription(): void {
  window.diskClean.onInvestigationTimeline?.((event) => {
    appendInvestigationTimelineEvent(event)
  })
}
