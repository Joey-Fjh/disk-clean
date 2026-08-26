// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  advanceToActionStep,
  enterRuleExtensionMode,
  exitRuleExtensionMode,
  getRuleExtensionStep,
  isRuleExtensionModeActive,
  shouldShowExtensionEntry,
  updateRuleSampleCount,
  wireRuleExtensionMode
} from '../src/renderer/rule-extension-mode'

function setupDom(): void {
  document.body.innerHTML = `
    <section id="rule-extension-card" hidden>
      <div id="rule-extension-step-select">
        <p id="rule-extension-selection-count"></p>
        <button id="rule-extension-cancel"></button>
        <button id="rule-extension-next" disabled></button>
      </div>
      <div id="rule-extension-step-action" hidden>
        <p id="rule-extension-action-desc"></p>
        <button id="rule-extension-back-select"></button>
        <button id="generate-rule-draft-btn" hidden></button>
        <button id="export-writing-pack-btn" hidden></button>
      </div>
      <div id="rule-extension-step-complete" hidden>
        <p id="rule-extension-complete-message"></p>
        <button id="rule-extension-open-settings"></button>
        <button id="rule-extension-back-results"></button>
      </div>
    </section>
  `
}

describe('rule extension mode', () => {
  beforeEach(() => {
    setupDom()
    exitRuleExtensionMode()
  })

  afterEach(() => {
    exitRuleExtensionMode()
  })

  it('starts inactive and shows select step when entered', () => {
    expect(isRuleExtensionModeActive()).toBe(false)
    enterRuleExtensionMode()
    expect(isRuleExtensionModeActive()).toBe(true)
    expect(getRuleExtensionStep()).toBe('select')
    expect(document.getElementById('rule-extension-card')?.hidden).toBe(false)
    exitRuleExtensionMode()
    expect(document.getElementById('rule-extension-card')?.hidden).toBe(true)
  })

  it('advances to action step with provider-specific buttons', () => {
    enterRuleExtensionMode()
    advanceToActionStep(true)
    expect(getRuleExtensionStep()).toBe('action')
    expect(document.getElementById('rule-extension-step-select')?.hidden).toBe(true)
    expect(document.getElementById('rule-extension-step-action')?.hidden).toBe(false)
    expect(document.getElementById('generate-rule-draft-btn')?.hidden).toBe(false)
    expect(document.getElementById('export-writing-pack-btn')?.hidden).toBe(true)

    advanceToActionStep(false)
    expect(document.getElementById('generate-rule-draft-btn')?.hidden).toBe(true)
    expect(document.getElementById('export-writing-pack-btn')?.hidden).toBe(false)
  })

  it('disables next until samples are selected', () => {
    enterRuleExtensionMode()
    const next = document.getElementById('rule-extension-next') as HTMLButtonElement
    expect(next.disabled).toBe(true)
    updateRuleSampleCount(2)
    expect(next.disabled).toBe(false)
    expect(document.getElementById('rule-extension-selection-count')?.textContent).toContain('2')
  })

  it('hides extension entry while active, scanning, or without dangerous candidates', () => {
    expect(shouldShowExtensionEntry({ scanning: false, hasSession: true, dangerousCandidateCount: 2 })).toBe(
      true
    )
    expect(shouldShowExtensionEntry({ scanning: true, hasSession: true, dangerousCandidateCount: 2 })).toBe(
      false
    )
    expect(shouldShowExtensionEntry({ scanning: false, hasSession: true, dangerousCandidateCount: 0 })).toBe(
      false
    )
    enterRuleExtensionMode()
    expect(shouldShowExtensionEntry({ scanning: false, hasSession: true, dangerousCandidateCount: 2 })).toBe(
      false
    )
  })

  it('wires cancel and next callbacks', () => {
    let exited = 0
    let next = 0
    wireRuleExtensionMode({
      onExit: () => {
        exited += 1
      },
      onNext: () => {
        next += 1
      },
      onBackToSelect: () => undefined,
      onOpenSettings: () => undefined,
      onBackToResults: () => undefined,
      getSelectedCount: () => 1
    })

    enterRuleExtensionMode()
    updateRuleSampleCount(1)
    document.getElementById('rule-extension-next')?.click()
    expect(next).toBe(1)
    document.getElementById('rule-extension-cancel')?.click()
    expect(exited).toBe(1)
  })
})
