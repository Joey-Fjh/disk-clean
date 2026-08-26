export type RuleExtensionStep = 'idle' | 'select' | 'action' | 'complete'

let active = false
let step: RuleExtensionStep = 'idle'
let providerHasKey = false

export function isRuleExtensionModeActive(): boolean {
  return active
}

export function getRuleExtensionStep(): RuleExtensionStep {
  return active ? step : 'idle'
}

function cardEl(): HTMLElement | null {
  return document.getElementById('rule-extension-card')
}

function syncCardVisibility(): void {
  const card = cardEl()
  if (!card) return

  if (!active) {
    card.hidden = true
    return
  }

  card.hidden = false
  const stepSelect = document.getElementById('rule-extension-step-select')
  const stepAction = document.getElementById('rule-extension-step-action')
  const stepComplete = document.getElementById('rule-extension-step-complete')
  if (stepSelect) stepSelect.hidden = step !== 'select'
  if (stepAction) stepAction.hidden = step !== 'action'
  if (stepComplete) stepComplete.hidden = step !== 'complete'

  if (step === 'action') {
    const actionDesc = document.getElementById('rule-extension-action-desc')
    const generateBtn = document.getElementById('generate-rule-draft-btn')
    const exportBtn = document.getElementById('export-writing-pack-btn')
    if (providerHasKey) {
      if (actionDesc) {
        actionDesc.textContent = '将根据所选样本生成一条待确认的识别规则。'
      }
      if (generateBtn) generateBtn.hidden = false
      if (exportBtn) exportBtn.hidden = true
    } else {
      if (actionDesc) {
        actionDesc.textContent =
          '未配置模型。可以导出规则资料，交给外部工具生成规则 JSON，导入后仍需预览并启用。'
      }
      if (generateBtn) generateBtn.hidden = true
      if (exportBtn) exportBtn.hidden = false
    }
  }
}

export function enterRuleExtensionMode(): void {
  active = true
  step = 'select'
  document.body.classList.add('rule-extension-mode')
  syncCardVisibility()
}

export function exitRuleExtensionMode(): void {
  active = false
  step = 'idle'
  document.body.classList.remove('rule-extension-mode')
  syncCardVisibility()
}

export function advanceToActionStep(hasKey: boolean): void {
  if (!active) return
  providerHasKey = hasKey
  step = 'action'
  syncCardVisibility()
}

export function backToSelectStep(): void {
  if (!active) return
  step = 'select'
  syncCardVisibility()
}

export function showCompleteStep(message: string): void {
  if (!active) return
  step = 'complete'
  const msgEl = document.getElementById('rule-extension-complete-message')
  if (msgEl) msgEl.textContent = message
  syncCardVisibility()
}

export function updateRuleSampleCount(count: number): void {
  const el = document.getElementById('rule-extension-selection-count')
  if (el) el.textContent = `已选择 ${count} 项规则样本`
  const nextBtn = document.getElementById('rule-extension-next') as HTMLButtonElement | null
  if (nextBtn) nextBtn.disabled = count === 0
}

export function shouldShowExtensionEntry(options: {
  scanning: boolean
  hasSession: boolean
  cancelled?: boolean
  dangerousCandidateCount?: number
}): boolean {
  return (
    !options.scanning &&
    options.hasSession &&
    options.cancelled !== true &&
    !active &&
    (options.dangerousCandidateCount ?? 0) > 0
  )
}

export function setExtensionEntryHostsVisible(visible: boolean): void {
  document.querySelectorAll<HTMLElement>('[data-role="rule-extension-entry-host"]').forEach((host) => {
    host.hidden = !visible
  })
}

export function wireRuleExtensionMode(options: {
  onExit: () => void
  onNext: () => void | Promise<void>
  onBackToSelect: () => void
  onOpenSettings: () => void
  onBackToResults: () => void
  getSelectedCount: () => number
}): void {
  document.getElementById('rule-extension-cancel')?.addEventListener('click', () => {
    exitRuleExtensionMode()
    options.onExit()
  })

  document.getElementById('rule-extension-next')?.addEventListener('click', () => {
    if (options.getSelectedCount() === 0) return
    void options.onNext()
  })

  document.getElementById('rule-extension-back-select')?.addEventListener('click', () => {
    backToSelectStep()
    options.onBackToSelect()
  })

  document.getElementById('rule-extension-back-results')?.addEventListener('click', () => {
    exitRuleExtensionMode()
    options.onBackToResults()
  })

  document.getElementById('rule-extension-open-settings')?.addEventListener('click', () => {
    options.onOpenSettings()
  })
}
