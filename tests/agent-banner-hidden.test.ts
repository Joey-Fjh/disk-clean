// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resetAgentAnalysisUi } from '../src/renderer/agent-analysis'

function setupBannerDom(): void {
  document.body.innerHTML = `
    <div id="agent-analysis-banner" hidden>
      <div id="agent-analysis-headline"></div>
      <div id="agent-analysis-overview"></div>
      <div id="agent-analysis-meta"></div>
      <button id="agent-analysis-retry" hidden></button>
      <button id="agent-analysis-settings-link" hidden></button>
    </div>
  `
}

describe('agent analysis banner hidden state', () => {
  beforeEach(() => {
    setupBannerDom()
    resetAgentAnalysisUi()
  })

  it('does not occupy layout when hidden attribute is set', () => {
    const banner = document.getElementById('agent-analysis-banner')!
    banner.hidden = true
    const style = readFileSync(join(process.cwd(), 'src/renderer/style.css'), 'utf-8')
    expect(style).toMatch(/\.agent-analysis-banner\[hidden\][\s\S]*display:\s*none\s*!important/)
    expect(banner.hidden).toBe(true)
  })

  it('stays hidden after resetAgentAnalysisUi', () => {
    const banner = document.getElementById('agent-analysis-banner')!
    resetAgentAnalysisUi()
    expect(banner.hidden).toBe(true)
  })
})
