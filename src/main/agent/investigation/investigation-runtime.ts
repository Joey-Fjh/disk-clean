import { randomUUID } from 'crypto'
import type { InvestigationPhase, InvestigationPublicStatus } from '../../../shared/investigation-types'
import { isInvestigationTerminal, transitionInvestigationPhase } from '../../../shared/investigation-state-machine'
import { INVESTIGATION_LIMITS } from '../../../shared/investigation-limits'
import { InvestigationBudget } from './investigation-budget'
import type { InvestigationAbortReason } from './investigation-abort'

export interface InvestigationRunState {
  requestId: string
  sessionId: string
  fingerprint: string
  startedAt: number
  phase: InvestigationPhase
  budget: InvestigationBudget
  modelId?: string
  conclusionModelId?: string
  lastErrorCode?: string
  lastErrorMessage?: string
  abortController: AbortController
  abortReason: InvestigationAbortReason | null
  investigationTimer: ReturnType<typeof setTimeout> | null
}

function terminalKey(sessionId: string, fingerprint: string): string {
  return `${sessionId}:${fingerprint}`
}

function toPublicStatus(run: InvestigationRunState): InvestigationPublicStatus {
  return {
    sessionId: run.sessionId,
    fingerprint: run.fingerprint,
    phase: run.phase,
    budget: run.budget.snapshot(),
    modelId: run.modelId,
    conclusionModelId: run.conclusionModelId,
    lastErrorCode: run.lastErrorCode,
    lastErrorMessage: run.lastErrorMessage
  }
}

export class InvestigationRuntime {
  private activeRun: InvestigationRunState | null = null
  private latestFingerprint: string | null = null
  private terminalByKey = new Map<string, InvestigationPublicStatus>()
  private finalizedAbortReasons = new Map<string, InvestigationAbortReason>()

  markSessionFingerprint(fingerprint: string): void {
    if (this.activeRun && this.activeRun.fingerprint !== fingerprint) {
      this.finalizeStale(this.activeRun)
    }
    if (this.activeRun) {
      this.clearHistoryExcept(this.activeRun.sessionId, fingerprint)
    }
    this.latestFingerprint = fingerprint
  }

  getTerminalStatus(sessionId: string, fingerprint: string): InvestigationPublicStatus | null {
    return this.terminalByKey.get(terminalKey(sessionId, fingerprint)) ?? null
  }

  getActiveRun(): InvestigationRunState | null {
    return this.activeRun
  }

  hasActiveRun(sessionId?: string): boolean {
    if (!this.activeRun) return false
    if (!sessionId) return true
    return this.activeRun.sessionId === sessionId
  }

  getAbortReason(requestId: string): InvestigationAbortReason | null {
    if (this.finalizedAbortReasons.has(requestId)) {
      return this.finalizedAbortReasons.get(requestId) ?? null
    }
    if (this.activeRun?.requestId !== requestId) return null
    return this.activeRun.abortReason
  }

  consumeAbortReason(requestId: string): void {
    this.finalizedAbortReasons.delete(requestId)
  }

  rollbackToolPhase(requestId: string): void {
    if (this.activeRun?.requestId !== requestId) return
    const phase = this.activeRun.phase
    if (phase === 'tool_requested' || phase === 'tool_running' || phase === 'analyzing_result') {
      this.activeRun.phase = 'analyzing'
      this.activeRun.abortReason = null
    }
  }

  finalizeBudgetExceeded(requestId: string): InvestigationPublicStatus {
    if (!this.activeRun || this.activeRun.requestId !== requestId) {
      throw new Error('INVESTIGATION_NOT_ACTIVE')
    }
    return this.complete(requestId, 'uncertain', {
      code: 'TOOL_LIMIT_EXCEEDED',
      message: '调查预算已用尽，无法进一步确定'
    })
  }

  advanceRound(requestId: string, sessionId: string, fingerprint: string): InvestigationPublicStatus {
    if (!this.activeRun || this.activeRun.requestId !== requestId) {
      throw new Error('INVESTIGATION_NOT_ACTIVE')
    }
    if (this.activeRun.sessionId !== sessionId || this.activeRun.fingerprint !== fingerprint) {
      throw new Error('SESSION_STALE')
    }
    if (this.activeRun.phase !== 'analyzing') {
      throw new Error('INVESTIGATION_INVALID_TRANSITION')
    }
    try {
      this.activeRun.budget.beginRound()
    } catch {
      return this.complete(requestId, 'uncertain', {
        code: 'TOOL_LIMIT_EXCEEDED',
        message: '调查预算已用尽，无法进一步确定'
      })
    }
    return toPublicStatus(this.activeRun)
  }

  clearHistoryExcept(sessionId: string, fingerprint?: string): void {
    for (const key of [...this.terminalByKey.keys()]) {
      if (!key.startsWith(`${sessionId}:`)) {
        this.terminalByKey.delete(key)
      }
    }
    if (fingerprint) {
      for (const key of [...this.terminalByKey.keys()]) {
        if (key.startsWith(`${sessionId}:`) && key !== terminalKey(sessionId, fingerprint)) {
          this.terminalByKey.delete(key)
        }
      }
    }
    this.pruneHistory()
  }

  private pruneHistory(): void {
    while (this.terminalByKey.size > INVESTIGATION_LIMITS.MAX_TERMINAL_HISTORY_ENTRIES) {
      const oldest = this.terminalByKey.keys().next().value
      if (!oldest) break
      this.terminalByKey.delete(oldest)
    }
    while (this.finalizedAbortReasons.size > INVESTIGATION_LIMITS.MAX_ABORT_REASON_HISTORY_ENTRIES) {
      const oldest = this.finalizedAbortReasons.keys().next().value
      if (!oldest) break
      this.finalizedAbortReasons.delete(oldest)
    }
  }

  setAbortReason(requestId: string, reason: InvestigationAbortReason | null): void {
    if (this.activeRun?.requestId === requestId) {
      this.activeRun.abortReason = reason
    }
  }

  resetPhaseToAnalyzing(requestId: string): void {
    if (this.activeRun?.requestId === requestId) {
      this.activeRun.phase = 'analyzing'
      this.activeRun.abortReason = null
    }
  }

  isActiveRequest(requestId: string, sessionId: string, fingerprint: string): boolean {
    return (
      this.activeRun?.requestId === requestId &&
      this.activeRun.sessionId === sessionId &&
      this.activeRun.fingerprint === fingerprint &&
      this.latestFingerprint === fingerprint
    )
  }

  canExecuteTool(requestId: string): boolean {
    if (!this.activeRun || this.activeRun.requestId !== requestId) return false
    return this.activeRun.phase === 'analyzing' || this.activeRun.phase === 'analyzing_result'
  }

  start(sessionId: string, fingerprint: string, modelId?: string): InvestigationPublicStatus {
    if (this.activeRun) {
      throw new Error('INVESTIGATION_IN_PROGRESS')
    }

    const run: InvestigationRunState = {
      requestId: randomUUID(),
      sessionId,
      fingerprint,
      startedAt: Date.now(),
      phase: 'analyzing',
      budget: new InvestigationBudget(),
      modelId,
      abortController: new AbortController(),
      abortReason: null,
      investigationTimer: null
    }
    run.budget.beginRound()
    run.investigationTimer = setTimeout(() => {
      if (this.activeRun?.requestId === run.requestId) {
        this.finalizeCancelled(run, 'investigation-timeout')
      }
    }, INVESTIGATION_LIMITS.INVESTIGATION_TIMEOUT_MS)

    this.activeRun = run
    this.latestFingerprint = fingerprint
    this.terminalByKey.delete(terminalKey(sessionId, fingerprint))
    this.clearHistoryExcept(sessionId, fingerprint)
    return toPublicStatus(run)
  }

  transition(requestId: string, event: Parameters<typeof transitionInvestigationPhase>[1]): InvestigationPhase {
    if (!this.activeRun || this.activeRun.requestId !== requestId) {
      throw new Error('INVESTIGATION_NOT_ACTIVE')
    }
    const next = transitionInvestigationPhase(this.activeRun.phase, event)
    if (next === this.activeRun.phase && event !== 'resume_analyzing') {
      if (event === 'request_tool' || event === 'run_tool' || event === 'tool_done') {
        throw new Error('INVESTIGATION_INVALID_TRANSITION')
      }
    }
    this.activeRun.phase = next
    return next
  }

  cancel(sessionId: string): InvestigationPublicStatus | null {
    if (!this.activeRun || this.activeRun.sessionId !== sessionId) {
      return this.getTerminalStatus(sessionId, this.latestFingerprint ?? '') ?? null
    }
    return this.finalizeCancelled(this.activeRun, 'user-cancel')
  }

  cancelActive(): void {
    if (this.activeRun) {
      this.finalizeCancelled(this.activeRun, 'user-cancel')
    }
  }

  complete(requestId: string, phase: 'completed' | 'uncertain' | 'failed', error?: { code: string; message: string }): InvestigationPublicStatus {
    if (!this.activeRun || this.activeRun.requestId !== requestId) {
      throw new Error('INVESTIGATION_NOT_ACTIVE')
    }
    const event = phase === 'completed' ? 'complete' : phase === 'uncertain' ? 'uncertain' : 'fail'
    this.activeRun.phase = transitionInvestigationPhase(this.activeRun.phase, event)
    if (error) {
      this.activeRun.lastErrorCode = error.code
      this.activeRun.lastErrorMessage = error.message
    }
    return this.finalizeTerminal(this.activeRun)
  }

  setConclusionModel(requestId: string, modelId: string): void {
    if (this.activeRun?.requestId === requestId) {
      this.activeRun.conclusionModelId = modelId
    }
  }

  setError(requestId: string, code: string, message: string): void {
    if (this.activeRun?.requestId === requestId) {
      this.activeRun.lastErrorCode = code
      this.activeRun.lastErrorMessage = message
    }
  }

  clearInvestigationTimer(run: InvestigationRunState): void {
    if (run.investigationTimer) {
      clearTimeout(run.investigationTimer)
      run.investigationTimer = null
    }
  }

  private finalizeStale(run: InvestigationRunState): InvestigationPublicStatus {
    run.abortReason = 'session-stale'
    run.phase = 'stale'
    run.abortController.abort()
    this.clearInvestigationTimer(run)
    return this.finalizeTerminal(run)
  }

  private finalizeCancelled(run: InvestigationRunState, reason: InvestigationAbortReason): InvestigationPublicStatus {
    run.abortReason = reason
    run.phase = reason === 'investigation-timeout' ? 'failed' : 'cancelled'
    if (reason === 'investigation-timeout') {
      run.lastErrorCode = 'TIMEOUT'
      run.lastErrorMessage = '调查超时'
    }
    run.abortController.abort()
    this.clearInvestigationTimer(run)
    return this.finalizeTerminal(run)
  }

  private finalizeTerminal(run: InvestigationRunState): InvestigationPublicStatus {
    if (run.abortReason) {
      this.finalizedAbortReasons.set(run.requestId, run.abortReason)
    }
    const status = toPublicStatus(run)
    this.terminalByKey.set(terminalKey(run.sessionId, run.fingerprint), status)
    if (this.activeRun?.requestId === run.requestId) {
      this.activeRun = null
    }
    this.pruneHistory()
    return status
  }

  markStale(): void {
    if (this.activeRun) {
      this.finalizeStale(this.activeRun)
    }
  }

  resolveStatus(sessionId: string, fingerprint: string): InvestigationPublicStatus {
    const active = this.activeRun
    if (active && active.sessionId === sessionId && active.fingerprint === fingerprint) {
      return toPublicStatus(active)
    }

    const terminal = this.getTerminalStatus(sessionId, fingerprint)
    if (terminal) return terminal

    const staleTerminal = [...this.terminalByKey.values()].find((entry) => entry.sessionId === sessionId)
    if (staleTerminal && staleTerminal.fingerprint !== fingerprint) {
      return {
        ...staleTerminal,
        fingerprint,
        phase: 'stale',
        lastErrorCode: 'SESSION_STALE',
        lastErrorMessage: '扫描会话已过期'
      }
    }

    return {
      sessionId,
      fingerprint,
      phase: 'idle',
      budget: {
        rounds: 0,
        toolCallsThisRound: 0,
        totalToolCalls: 0,
        totalResponseBytes: 0
      }
    }
  }
}

let investigationRuntime = new InvestigationRuntime()

export function getInvestigationRuntime(): InvestigationRuntime {
  return investigationRuntime
}

export function setInvestigationRuntimeForTests(runtime: InvestigationRuntime): void {
  investigationRuntime = runtime
}

export function notifyInvestigationSessionStale(): void {
  getInvestigationRuntime().markStale()
}

export function notifyInvestigationSessionFingerprint(fingerprint: string): void {
  getInvestigationRuntime().markSessionFingerprint(fingerprint)
}

export { isInvestigationTerminal, toPublicStatus }
