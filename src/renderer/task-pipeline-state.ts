import type { AgentAnalysisStatus } from '../shared/agent-types'
import { UX_PIPELINE_STEPS, type UxPipelineStepId } from '../shared/ux-flow-model'

export class TaskPipelineState {
  private milestone: UxPipelineStepId | null = null
  private analyzeSkipped = false

  reset(): void {
    this.milestone = null
    this.analyzeSkipped = false
  }

  markAnalyzeSkipped(): void {
    this.analyzeSkipped = true
  }

  advance(step: UxPipelineStepId): void {
    const order = UX_PIPELINE_STEPS.map((entry) => entry.id)
    const current = this.milestone ? order.indexOf(this.milestone) : -1
    const next = order.indexOf(step)
    if (next > current) {
      this.milestone = step
    }
  }

  getMilestone(): UxPipelineStepId | null {
    return this.milestone
  }

  isAnalyzeSkipped(): boolean {
    return this.analyzeSkipped
  }
}

export function applyResultsReadyPipeline(
  pipeline: TaskPipelineState,
  analysisStatus?: AgentAnalysisStatus
): void {
  if (analysisStatus === 'skipped_no_provider' || analysisStatus === 'cancelled') {
    pipeline.markAnalyzeSkipped()
  } else {
    pipeline.advance('analyze')
  }
  pipeline.advance('suggest')
}
