import type { AgentAnalysisStatus } from '../shared/agent-types'
import {
  UX_PIPELINE_STEPS,
  type ReviewStepOutcome,
  type UxPipelineStepId
} from '../shared/ux-flow-model'

export class TaskPipelineState {
  private milestone: UxPipelineStepId | null = null
  private analyzeSkipped = false
  private reviewOutcome: ReviewStepOutcome = 'none'

  reset(): void {
    this.milestone = null
    this.analyzeSkipped = false
    this.reviewOutcome = 'none'
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

  completeReview(): void {
    this.advance('review')
    this.reviewOutcome = 'done'
  }

  beginReview(): void {
    this.reviewOutcome = 'none'
  }

  markReviewStopped(): void {
    this.reviewOutcome = 'stopped'
  }

  markReviewFailed(): void {
    this.reviewOutcome = 'failed'
  }

  getMilestone(): UxPipelineStepId | null {
    return this.milestone
  }

  isAnalyzeSkipped(): boolean {
    return this.analyzeSkipped
  }

  getReviewOutcome(): ReviewStepOutcome {
    return this.reviewOutcome
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
