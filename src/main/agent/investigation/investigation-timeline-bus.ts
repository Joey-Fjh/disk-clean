import type { WebContents } from 'electron'
import {
  MAX_INVESTIGATION_TIMELINE_ENTRIES,
  MAX_INVESTIGATION_TIMELINE_TEXT,
  type InvestigationTimelineEvent
} from '../../../shared/investigation-timeline-types'

export type TimelineSink = (event: InvestigationTimelineEvent) => void

let activeSink: TimelineSink | null = null

export function setInvestigationTimelineSink(sink: TimelineSink | null): void {
  activeSink = sink
}

export function createWebContentsTimelineSink(
  webContents: WebContents,
  isTrusted: () => boolean
): TimelineSink {
  return (event) => {
    if (!isTrusted()) return
    if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) return
    if (typeof webContents.send !== 'function') return
    webContents.send('agent:investigation-timeline', event)
  }
}

export function truncateTimelineText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_INVESTIGATION_TIMELINE_TEXT) return trimmed
  return `${trimmed.slice(0, MAX_INVESTIGATION_TIMELINE_TEXT - 1)}…`
}

export class InvestigationTimelineCollector {
  private events: InvestigationTimelineEvent[] = []

  constructor(
    private readonly sessionId: string,
    private readonly generation: string,
    private readonly sink: TimelineSink | null = activeSink
  ) {}

  emit(
    type: InvestigationTimelineEvent['type'],
    message: string,
    extra: Partial<
      Pick<
        InvestigationTimelineEvent,
        'candidateRef' | 'tool' | 'itemCount' | 'byteCount' | 'truncated' | 'cached'
      >
    > = {}
  ): void {
    const event: InvestigationTimelineEvent = {
      schemaVersion: 1,
      type,
      sessionId: this.sessionId,
      generation: this.generation,
      at: Date.now(),
      message: truncateTimelineText(message),
      ...extra
    }
    if (this.events.length >= MAX_INVESTIGATION_TIMELINE_ENTRIES) {
      this.events.shift()
    }
    this.events.push(event)
    this.sink?.(event)
  }

  snapshot(): InvestigationTimelineEvent[] {
    return [...this.events]
  }
}
