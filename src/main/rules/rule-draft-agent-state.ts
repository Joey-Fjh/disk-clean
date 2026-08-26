import { randomUUID } from 'crypto'

export interface RuleDraftRunState {
  requestId: string
  sessionId: string
  startedAt: number
  abortController: AbortController
}

export class RuleDraftAgentState {
  private activeRun: RuleDraftRunState | null = null
  private completedSessionId: string | null = null
  private latestSessionId: string | null = null

  markNewScanSession(sessionId: string): void {
    this.cancelActiveRun('stale')
    this.latestSessionId = sessionId
    this.completedSessionId = null
  }

  markScanStarting(): void {
    this.cancelActiveRun('stale')
    this.latestSessionId = null
    this.completedSessionId = null
  }

  cancelActiveRun(_reason: 'stale' | 'cancelled' = 'cancelled'): void {
    if (this.activeRun) {
      this.activeRun.abortController.abort()
      this.activeRun = null
    }
  }

  beginRun(sessionId: string): RuleDraftRunState {
    this.cancelActiveRun('cancelled')
    const run: RuleDraftRunState = {
      requestId: randomUUID(),
      sessionId,
      startedAt: Date.now(),
      abortController: new AbortController()
    }
    this.activeRun = run
    return run
  }

  endRun(requestId: string): void {
    if (this.activeRun?.requestId === requestId) {
      this.activeRun = null
    }
  }

  isActiveRequest(requestId: string, sessionId: string): boolean {
    return (
      this.activeRun?.requestId === requestId &&
      this.activeRun.sessionId === sessionId &&
      this.latestSessionId === sessionId
    )
  }

  isLatestSession(sessionId: string): boolean {
    return this.latestSessionId === sessionId
  }

  markCompleted(sessionId: string): void {
    this.completedSessionId = sessionId
  }

  hasCompleted(sessionId: string): boolean {
    return this.completedSessionId === sessionId
  }

  getActiveRun(): RuleDraftRunState | null {
    return this.activeRun
  }
}

let draftState = new RuleDraftAgentState()

export function getRuleDraftAgentState(): RuleDraftAgentState {
  return draftState
}

export function setRuleDraftAgentStateForTests(state: RuleDraftAgentState): void {
  draftState = state
}
