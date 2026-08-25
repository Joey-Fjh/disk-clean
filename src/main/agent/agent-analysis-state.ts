import { randomUUID } from 'crypto'

export interface AgentRunState {
  requestId: string
  sessionId: string
  startedAt: number
  abortController: AbortController
}

export class AgentAnalysisState {
  private activeRun: AgentRunState | null = null
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

  beginRun(sessionId: string): AgentRunState {
    this.cancelActiveRun('cancelled')
    const run: AgentRunState = {
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

  getActiveRun(): AgentRunState | null {
    return this.activeRun
  }
}

let analysisState = new AgentAnalysisState()

export function getAgentAnalysisState(): AgentAnalysisState {
  return analysisState
}

export function setAgentAnalysisStateForTests(state: AgentAnalysisState): void {
  analysisState = state
}
