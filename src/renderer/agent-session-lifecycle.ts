import type { AgentAnalysisStatus } from '../shared/agent-types'
import type { ScanItem, ScanResult } from '../shared/types'
import type { AgentAnalysisCallbacks } from './agent-analysis'
import { getCurrentAgentAnalysis } from './agent-analysis'
import type { ScanTaskPhase } from './scan-task-state'
import { runPlanningPhase } from './cleanup-task-ui'

export interface AgentSessionLifecycleContext {
  /** When set, item updates for other sessions are ignored. */
  sessionId?: string
  getScanResult: () => ScanResult | null
  setScanResult: (result: ScanResult) => void
  setTaskPhase: (phase: ScanTaskPhase) => void
  refreshTaskProgress: (itemCount: number) => void
  reconcileSelection: (items: ScanItem[]) => void | Promise<void>
  renderCategories: (items: ScanItem[]) => void
  updateSelectedSummary: () => void
  preservePanelScroll: (fn: () => void) => void
  openSettings: () => void
  onResultsReady?: (items: ScanItem[], analysisStatus?: AgentAnalysisStatus) => void
}

/** Shared Agent analysis lifecycle hooks for first-run auto analysis and manual retry. */
export function createAgentAnalysisSessionCallbacks(
  ctx: AgentSessionLifecycleContext
): AgentAnalysisCallbacks {
  return {
    onStart: () => {
      ctx.setTaskPhase('analyzing')
      ctx.refreshTaskProgress(ctx.getScanResult()?.items.length ?? 0)
    },
    onItemsUpdated: async (items) => {
      const scanResult = ctx.getScanResult()
      if (!scanResult) return
      if (ctx.sessionId && scanResult.sessionId !== ctx.sessionId) return
      ctx.setScanResult({ ...scanResult, items })
      await ctx.reconcileSelection(items)
      await runPlanningPhase(
        (phase) => ctx.setTaskPhase(phase),
        () => ctx.refreshTaskProgress(items.length)
      )
      ctx.setTaskPhase('completed')
      ctx.refreshTaskProgress(items.length)
      ctx.preservePanelScroll(() => ctx.renderCategories(items))
      ctx.updateSelectedSummary()
      ctx.onResultsReady?.(items, getCurrentAgentAnalysis()?.status)
    },
    onFailed: async () => {
      ctx.setTaskPhase('failed')
      const scanResult = ctx.getScanResult()
      if (scanResult) {
        ctx.preservePanelScroll(() => ctx.renderCategories(scanResult.items))
        ctx.onResultsReady?.(scanResult.items, getCurrentAgentAnalysis()?.status)
      }
      ctx.refreshTaskProgress(scanResult?.items.length ?? 0)
    },
    onCancelled: async () => {
      ctx.setTaskPhase('completed')
      const scanResult = ctx.getScanResult()
      if (scanResult) {
        ctx.preservePanelScroll(() => ctx.renderCategories(scanResult.items))
        ctx.onResultsReady?.(scanResult.items, getCurrentAgentAnalysis()?.status)
      }
      ctx.refreshTaskProgress(scanResult?.items.length ?? 0)
    },
    openSettings: ctx.openSettings
  }
}
