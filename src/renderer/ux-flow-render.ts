import type { CleanupTaskPhase } from '../shared/cleanup-task-model'
import {
  buildCleanupOutcomeDetailLines,
  buildCleanupOutcomeHeadline,
  resolveActivePipelineStep,
  resolveCleanupOutcomeTone,
  resolvePipelineStepState,
  shouldShowTaskPipeline,
  UX_PIPELINE_STEPS,
  type UxPipelineStepId
} from '../shared/ux-flow-model'
import type { CleanupOutcomeManifest } from './cleanup-result-state'

function toOutcomeSummary(manifest: CleanupOutcomeManifest) {
  return {
    moved: manifest.result.moved,
    movedToTrashBytes: manifest.result.movedToTrashBytes,
    prepareRejectedCount: manifest.prepareRejected.length,
    executionFailedCount: manifest.executionFailed.length,
    executionRejectedCount: manifest.executionRejected.length
  }
}

export function renderTaskPipeline(
  container: HTMLElement,
  input: {
    phase: CleanupTaskPhase
    scanning: boolean
    hasScanResults: boolean
    milestone?: UxPipelineStepId | null
    analyzeSkipped?: boolean
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
      analyzeSkipped: input.analyzeSkipped
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
    }
    list.appendChild(item)
  }

  container.appendChild(list)
}

export function renderCleanupOutcomePanel(
  panel: HTMLElement,
  manifest: CleanupOutcomeManifest | null,
  comparisonDetail?: string
): void {
  if (!manifest) {
    panel.hidden = true
    panel.replaceChildren()
    return
  }

  const tone = resolveCleanupOutcomeTone(toOutcomeSummary(manifest))
  panel.hidden = false
  panel.className = `cleanup-outcome-panel tone-${tone}`
  panel.replaceChildren()

  const title = document.createElement('h3')
  title.className = 'cleanup-outcome-title'
  title.textContent = buildCleanupOutcomeHeadline(toOutcomeSummary(manifest))

  const list = document.createElement('ul')
  list.className = 'cleanup-outcome-details'
  for (const line of buildCleanupOutcomeDetailLines(toOutcomeSummary(manifest))) {
    const li = document.createElement('li')
    li.textContent = line
    list.appendChild(li)
  }

  panel.append(title, list)

  if (comparisonDetail) {
    const comparison = document.createElement('p')
    comparison.className = 'cleanup-outcome-comparison'
    comparison.textContent = comparisonDetail
    panel.appendChild(comparison)
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
