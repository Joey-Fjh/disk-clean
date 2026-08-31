import type { CleanupTaskPhase } from '../shared/cleanup-task-model'
import {
  buildCleanupOutcomeDetailLines,
  buildCleanupOutcomeHeadline,
  resolveActivePipelineStep,
  resolveCleanupOutcomeTone,
  resolvePipelineStepState,
  shouldShowTaskPipeline,
  UX_PIPELINE_STEPS,
  type ReviewStepOutcome,
  type UxPipelineStepId
} from '../shared/ux-flow-model'
import {
  buildCleanupOutcomeSummaryInput,
  type CleanupOutcomeManifest,
  type CleanupRescanComparison
} from './cleanup-result-state'

export function renderTaskPipeline(
  container: HTMLElement,
  input: {
    phase: CleanupTaskPhase
    scanning: boolean
    hasScanResults: boolean
    milestone?: UxPipelineStepId | null
    analyzeSkipped?: boolean
    reviewOutcome?: ReviewStepOutcome
  }
): void {
  if (!shouldShowTaskPipeline(input)) {
    container.hidden = true
    container.replaceChildren()
    return
  }

  const activeStep = resolveActivePipelineStep({
    phase: input.phase,
    hasScanResults: input.hasScanResults,
    milestone: input.milestone
  })

  container.hidden = false
  container.replaceChildren()

  const list = document.createElement('ol')
  list.className = 'task-pipeline-steps'
  list.setAttribute('aria-label', '清理流程')

  for (const step of UX_PIPELINE_STEPS) {
    const state = resolvePipelineStepState(step.id, {
      activeStep,
      phase: input.phase,
      milestone: input.milestone,
      analyzeSkipped: input.analyzeSkipped,
      reviewOutcome: input.reviewOutcome
    })

    const item = document.createElement('li')
    item.className = `task-pipeline-step is-${state}`
    item.dataset.step = step.id

    const marker = document.createElement('span')
    marker.className = 'task-pipeline-marker'
    marker.setAttribute('aria-hidden', 'true')

    const label = document.createElement('span')
    label.className = 'task-pipeline-label'
    label.textContent = step.label

    if (state === 'active') {
      item.setAttribute('aria-current', 'step')
    }

    item.append(marker, label)
    if (state === 'skipped') {
      const skipNote = document.createElement('span')
      skipNote.className = 'task-pipeline-skip-note'
      skipNote.textContent = '已跳过'
      item.appendChild(skipNote)
    } else if (state === 'stopped') {
      const stopNote = document.createElement('span')
      stopNote.className = 'task-pipeline-skip-note'
      stopNote.textContent = '已停止'
      item.appendChild(stopNote)
    } else if (state === 'failed') {
      const failNote = document.createElement('span')
      failNote.className = 'task-pipeline-skip-note'
      failNote.textContent = '未完成'
      item.appendChild(failNote)
    }
    list.appendChild(item)
  }

  container.appendChild(list)
}

export function renderCleanupOutcomePanel(
  panel: HTMLElement,
  manifest: CleanupOutcomeManifest | null,
  comparisonDetail?: string,
  comparison?: CleanupRescanComparison
): void {
  if (!manifest) {
    panel.hidden = true
    panel.replaceChildren()
    return
  }

  const summary = buildCleanupOutcomeSummaryInput(manifest, comparison)
  const tone = resolveCleanupOutcomeTone(summary)
  panel.hidden = false
  panel.className = `cleanup-outcome-panel tone-${tone}`
  panel.replaceChildren()

  const title = document.createElement('h3')
  title.className = 'cleanup-outcome-title'
  title.textContent = buildCleanupOutcomeHeadline(summary)

  const list = document.createElement('ul')
  list.className = 'cleanup-outcome-details'
  for (const line of buildCleanupOutcomeDetailLines(summary)) {
    const li = document.createElement('li')
    li.textContent = line
    list.appendChild(li)
  }

  panel.append(title, list)

  if (comparisonDetail && !comparison) {
    const comparisonEl = document.createElement('p')
    comparisonEl.className = 'cleanup-outcome-comparison'
    comparisonEl.textContent = comparisonDetail
    panel.appendChild(comparisonEl)
  }

  const failedPaths = [
    ...manifest.executionFailed.map((entry) => entry.path),
    ...manifest.executionRejected.map((entry) => entry.path),
    ...manifest.prepareRejected.map((entry) => entry.path)
  ]
  if (failedPaths.length > 0) {
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'btn btn-link cleanup-outcome-failures-toggle'
    toggle.textContent = `查看 ${failedPaths.length} 个未成功项`
    toggle.setAttribute('aria-expanded', 'false')

    const failures = document.createElement('ul')
    failures.className = 'cleanup-outcome-failures'
    failures.hidden = true
    for (const path of failedPaths.slice(0, 20)) {
      const li = document.createElement('li')
      li.textContent = path
      failures.appendChild(li)
    }
    if (failedPaths.length > 20) {
      const more = document.createElement('li')
      more.textContent = `另有 ${failedPaths.length - 20} 项…`
      failures.appendChild(more)
    }

    toggle.addEventListener('click', () => {
      const expanded = failures.hidden
      failures.hidden = !expanded
      toggle.setAttribute('aria-expanded', String(expanded))
    })

    panel.append(toggle, failures)
  }
}

export function applyProgressBarMode(
  progressEl: HTMLElement,
  fillEl: HTMLElement,
  mode: 'hidden' | 'determinate' | 'indeterminate',
  percent?: number
): void {
  const bar = progressEl.querySelector<HTMLElement>('.progress-bar')
  progressEl.classList.toggle('progress-indeterminate', mode === 'indeterminate')
  if (mode === 'hidden') {
    progressEl.hidden = true
    fillEl.style.width = '0%'
    bar?.removeAttribute('aria-valuenow')
    bar?.setAttribute('aria-valuetext', '未开始')
    return
  }
  progressEl.hidden = false
  if (mode === 'indeterminate') {
    fillEl.style.width = '100%'
    bar?.removeAttribute('aria-valuenow')
    bar?.setAttribute('aria-valuetext', '进行中')
    return
  }
  const value = Math.min(Math.max(percent ?? 0, 0), 100)
  fillEl.style.width = `${value}%`
  bar?.setAttribute('aria-valuenow', String(Math.round(value)))
  bar?.setAttribute('aria-valuetext', `${Math.round(value)}%`)
}
