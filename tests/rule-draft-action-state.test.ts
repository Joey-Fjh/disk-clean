// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { updateRuleDraftActionState } from '../src/renderer/rule-draft-actions'
import type { ScanResult } from '../src/shared/types'

function setupActionButtons(): void {
  document.body.innerHTML = `
    <button id="generate-rule-draft-btn" disabled hidden></button>
    <button id="export-writing-pack-btn" disabled hidden></button>
    <p id="rule-draft-action-status"></p>
  `
}

function mockScanResult(): ScanResult {
  return {
    sessionId: 'session-1',
    drive: 'C:',
    mode: 'full',
    cancelled: false,
    items: [],
    errors: [],
    totalSize: 1024,
    scannedAt: new Date().toISOString()
  }
}

describe('rule draft action state', () => {
  beforeEach(() => {
    setupActionButtons()
  })

  it('keeps action buttons enabled in action step when cleanup selection changes', () => {
    const scanResult = mockScanResult()
    const ruleDraftSelectedIds = new Set(['item-1'])

    updateRuleDraftActionState({
      scanResult,
      scanning: false,
      ruleDraftSelectedIds,
      extensionStep: 'action'
    })

    const generate = document.getElementById('generate-rule-draft-btn') as HTMLButtonElement
    const exportPack = document.getElementById('export-writing-pack-btn') as HTMLButtonElement
    expect(generate.disabled).toBe(false)
    expect(exportPack.disabled).toBe(false)

    // Simulate updateSelectedSummary() without extensionStep (regression guard).
    updateRuleDraftActionState({
      scanResult,
      scanning: false,
      ruleDraftSelectedIds
    })
    expect(generate.disabled).toBe(true)

    updateRuleDraftActionState({
      scanResult,
      scanning: false,
      ruleDraftSelectedIds,
      extensionStep: 'action'
    })
    expect(generate.disabled).toBe(false)
    expect(exportPack.disabled).toBe(false)
  })

  it('disables action buttons outside action step even with rule samples selected', () => {
    const scanResult = mockScanResult()
    const ruleDraftSelectedIds = new Set(['item-1'])

    updateRuleDraftActionState({
      scanResult,
      scanning: false,
      ruleDraftSelectedIds,
      extensionStep: 'select'
    })

    const generate = document.getElementById('generate-rule-draft-btn') as HTMLButtonElement
    const exportPack = document.getElementById('export-writing-pack-btn') as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    expect(exportPack.disabled).toBe(true)
  })
})
