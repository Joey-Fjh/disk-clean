import type { JudgmentOrigin } from './types'
import type { CleanupTaskPhase } from './cleanup-task-model'
import type { ScanItem } from './types'

export interface CleanupOutcomeSummaryInput {
  moved: number
  movedToTrashBytes: number
  prepareRejectedCount: number
  executionFailedCount: number
  executionRejectedCount: number
  hasRescanComparison?: boolean
  rescanDisappearedCount?: number
  rescanStillPresentCount?: number
}

/** 主流程步骤（7A 用户可见流水线）。 */
export const UX_PIPELINE_STEPS = [
  { id: 'scan', label: '扫描识别' },
  { id: 'analyze', label: '智能分析' },
  { id: 'suggest', label: '清理建议' },
  { id: 'execute', label: '移入回收站' },
  { id: 'review', label: '自动复核' }
] as const

export type UxPipelineStepId = (typeof UX_PIPELINE_STEPS)[number]['id']

export type UxPipelineStepState = 'pending' | 'active' | 'done' | 'skipped' | 'stopped' | 'failed'

export type ReviewStepOutcome = 'none' | 'done' | 'stopped' | 'failed'

export type UserFacingJudgmentSource =
  | '本地规则'
  | 'Agent'
  | '本地规则 + Agent'
  | '安全策略'
  | '空间发现'

export type ProgressBarMode = 'hidden' | 'determinate' | 'indeterminate'

export function resolveUserFacingJudgmentSource(item: ScanItem): UserFacingJudgmentSource {
  const origin: JudgmentOrigin | undefined = item.judgment?.judgmentOrigin
  if (origin === 'protected-policy') return '安全策略'
  if (origin === 'local-rule-agent-reviewed') return '本地规则 + Agent'
  if (origin === 'local-rule') return '本地规则'
  if (origin === 'agent-session' || origin === 'agent-advice-only') return 'Agent'
  if (origin === 'space-evidence-only') return '空间发现'

  const hasRule = item.discoverySources?.includes('rule') ?? item.source === 'rule'
  const hasAgent = item.judgment?.source === 'agent' || Boolean(item.agentInsight)
  if (hasRule && hasAgent) return '本地规则 + Agent'
  if (hasRule) return '本地规则'
  if (hasAgent) return 'Agent'
  return '空间发现'
}

export function shouldShowFinalResultCategories(input: {
  scanning: boolean
  phase: CleanupTaskPhase
  agentReviewing: boolean
}): boolean {
  if (input.scanning) return false
  if (input.agentReviewing) return false
  if (input.phase === 'analyzing' || input.phase === 'planning' || input.phase === 'organizing') {
    return false
  }
  return true
}

export function resolveActivePipelineStep(input: {
  phase: CleanupTaskPhase
  hasScanResults: boolean
  milestone?: UxPipelineStepId | null
}): UxPipelineStepId | null {
  switch (input.phase) {
    case 'scanning':
    case 'organizing':
    case 'cancelled':
      return 'scan'
    case 'analyzing':
    case 'failed':
      return 'analyze'
    case 'planning':
      return 'suggest'
    case 'executing':
      return 'execute'
    case 'rescanning':
      return 'review'
    case 'completed':
    case 'idle':
      return input.milestone ?? (input.hasScanResults ? 'suggest' : null)
    default:
      return input.hasScanResults ? 'suggest' : null
  }
}

export function resolvePipelineStepState(
  stepId: UxPipelineStepId,
  input: {
    activeStep: UxPipelineStepId | null
    phase: CleanupTaskPhase
    milestone?: UxPipelineStepId | null
    analyzeSkipped?: boolean
    reviewOutcome?: ReviewStepOutcome
  }
): UxPipelineStepState {
  if (stepId === 'review') {
    if (input.reviewOutcome === 'stopped') return 'stopped'
    if (input.reviewOutcome === 'failed') return 'failed'
  }

  const order = UX_PIPELINE_STEPS.map((step) => step.id)
  const stepIndex = order.indexOf(stepId)
  const milestoneIndex =
    input.milestone !== undefined && input.milestone !== null ? order.indexOf(input.milestone) : -1
  const resting = input.phase === 'completed' || input.phase === 'idle'

  if (resting && milestoneIndex >= 0) {
    if (stepIndex <= milestoneIndex) {
      if (stepId === 'analyze' && input.analyzeSkipped) return 'skipped'
      return 'done'
    }
    return 'pending'
  }

  if (!input.activeStep) return 'pending'

  const activeIndex = order.indexOf(input.activeStep)
  if (activeIndex < 0) return 'pending'
  if (stepIndex < activeIndex) {
    if (stepId === 'analyze' && input.analyzeSkipped) return 'skipped'
    return 'done'
  }
  if (stepIndex === activeIndex) return 'active'
  if (stepId === 'analyze' && input.analyzeSkipped && stepIndex < activeIndex) {
    return 'skipped'
  }
  return 'pending'
}

export function shouldShowTaskPipeline(input: {
  phase: CleanupTaskPhase
  scanning: boolean
  hasScanResults: boolean
}): boolean {
  if (input.scanning) return true
  if (input.phase !== 'idle') return true
  return input.hasScanResults
}

export function resolveProgressBarMode(input: {
  scanning: boolean
  phase: CleanupTaskPhase
  scanPhase?: 'space-discovery' | 'rule-identification'
}): ProgressBarMode {
  if (!input.scanning && input.phase !== 'executing' && input.phase !== 'rescanning') {
    return 'hidden'
  }
  if (input.phase === 'executing' || input.phase === 'rescanning') return 'indeterminate'
  if (input.scanPhase === 'rule-identification') return 'determinate'
  return 'indeterminate'
}

export type CleanupOutcomeTone = 'success' | 'partial' | 'failed'

function hasRescanStillPresent(input: CleanupOutcomeSummaryInput): boolean {
  return input.hasRescanComparison === true && (input.rescanStillPresentCount ?? 0) > 0
}

export function resolveCleanupOutcomeTone(input: CleanupOutcomeSummaryInput): CleanupOutcomeTone {
  const moved = input.moved
  const failed = input.prepareRejectedCount + input.executionFailedCount + input.executionRejectedCount
  if (moved > 0 && failed === 0) {
    if (hasRescanStillPresent(input)) return 'partial'
    return 'success'
  }
  if (moved > 0 && failed > 0) return 'partial'
  if (moved === 0 && failed > 0) return 'failed'
  return moved > 0 ? 'success' : 'failed'
}

export function buildCleanupOutcomeHeadline(input: CleanupOutcomeSummaryInput): string {
  const failed =
    input.prepareRejectedCount + input.executionFailedCount + input.executionRejectedCount
  const tone = resolveCleanupOutcomeTone(input)

  if (failed > 0) {
    if (tone === 'failed') return '清理未成功'
    return '部分项目已移入回收站'
  }
  if (hasRescanStillPresent(input) && input.moved > 0) {
    return '清理已执行，复核发现项目仍存在'
  }
  if (tone === 'success') return '清理完成'
  if (tone === 'partial') return '部分项目已移入回收站'
  return '清理未成功'
}

export function buildCleanupOutcomeDetailLines(input: CleanupOutcomeSummaryInput): string[] {
  const lines: string[] = [
    `已移入回收站 ${input.moved} 项（估算 ${input.movedToTrashBytes} 字节）`
  ]
  if (input.prepareRejectedCount > 0) {
    lines.push(`计划阶段未批准 ${input.prepareRejectedCount} 项`)
  }
  if (input.executionFailedCount > 0) {
    lines.push(`执行失败 ${input.executionFailedCount} 项`)
  }
  if (input.executionRejectedCount > 0) {
    lines.push(`执行校验拒绝 ${input.executionRejectedCount} 项`)
  }
  if (input.hasRescanComparison) {
    lines.push(
      `复核结果：${input.rescanDisappearedCount ?? 0} 项已消失，${input.rescanStillPresentCount ?? 0} 项仍存在`
    )
    if (hasRescanStillPresent(input)) {
      lines.push('项目可能已被程序重新生成，或未能完全移除。')
    }
  }
  lines.push('文件在回收站中仍占用磁盘空间，清空回收站后才会释放')
  return lines
}

export function shouldShowExtensionEntryForCategory(category: string): boolean {
  return category === 'space-occupancy'
}
