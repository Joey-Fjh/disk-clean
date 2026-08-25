// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { SubTabGroup, applySubTabDom } from '../src/renderer/sub-tab-group'

describe('SubTabGroup', () => {
  it('activates provider config and test tabs', () => {
    const group = new SubTabGroup(
      [
        { id: 'config', label: '连接配置' },
        { id: 'test', label: '连接测试' }
      ],
      'config'
    )
    expect(group.getActiveId()).toBe('config')
    group.activate('test')
    expect(group.getActiveId()).toBe('test')
  })

  it('updates aria-selected and panel visibility in the DOM', () => {
    document.body.innerHTML = `
      <div id="root">
        <button role="tab" data-subtab="config" aria-selected="true"></button>
        <button role="tab" data-subtab="test" aria-selected="false" tabindex="-1"></button>
        <div data-subtab-panel="config"></div>
        <div data-subtab-panel="test" hidden></div>
      </div>
    `
    const root = document.getElementById('root')!
    const group = new SubTabGroup(
      [
        { id: 'config', label: '连接配置' },
        { id: 'test', label: '连接测试' }
      ],
      'config'
    )
    group.activate('test')
    applySubTabDom(root, group, { panelAttr: 'data-subtab-panel' })

    const tabs = root.querySelectorAll<HTMLElement>('[role="tab"]')
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('false')
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    expect(root.querySelector('[data-subtab-panel="config"]')?.hasAttribute('hidden')).toBe(true)
    expect(root.querySelector('[data-subtab-panel="test"]')?.hasAttribute('hidden')).toBe(false)
  })
})
