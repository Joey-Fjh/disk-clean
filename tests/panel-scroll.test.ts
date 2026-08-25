// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  preservePanelScrollTop,
  restorePanelScrollTop,
  savePanelScrollTop,
  switchMainTabPanel
} from '../src/renderer/panel-scroll'

function createPanel(id: string, active = false): HTMLElement {
  const panel = document.createElement('div')
  panel.id = id
  panel.className = `tab-panel${active ? ' active' : ''}`
  panel.style.height = '100px'
  panel.style.overflow = 'auto'
  panel.innerHTML = '<div style="height:400px"></div>'
  document.body.appendChild(panel)
  return panel
}

describe('panel scroll', () => {
  it('saves and restores scrollTop per panel', () => {
    const panel = createPanel('panel-settings')
    panel.scrollTop = 120
    savePanelScrollTop(panel)
    panel.scrollTop = 0
    restorePanelScrollTop(panel)
    expect(panel.scrollTop).toBe(120)
    panel.remove()
  })

  it('preserves scrollTop across DOM mutations', () => {
    const panel = createPanel('panel-clean')
    panel.scrollTop = 80
    preservePanelScrollTop(panel, () => {
      panel.innerHTML = '<div style="height:600px"></div>'
    })
    expect(panel.scrollTop).toBe(80)
    panel.remove()
  })

  it('restores each panel scroll position when switching main tabs', () => {
    document.body.innerHTML = ''
    const clean = createPanel('panel-clean', true)
    const settings = createPanel('panel-settings')
    clean.scrollTop = 50
    savePanelScrollTop(clean)

    switchMainTabPanel(document.querySelectorAll('.tab-panel'), 'panel-settings')
    settings.scrollTop = 90
    savePanelScrollTop(settings)

    switchMainTabPanel(document.querySelectorAll('.tab-panel'), 'panel-clean')
    expect(clean.classList.contains('active')).toBe(true)
    expect(clean.scrollTop).toBe(50)

    switchMainTabPanel(document.querySelectorAll('.tab-panel'), 'panel-settings')
    expect(settings.scrollTop).toBe(90)

    document.body.innerHTML = ''
  })
})
