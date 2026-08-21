// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createScanItemElement } from '../src/renderer/safe-render'

describe('createScanItemElement', () => {
  it('does not interpret html in file name or path', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const li = createScanItemElement({
      fileName: payload,
      path: `C:\\temp\\${payload}`,
      typeLabel: 'test',
      sizeLabel: '1 KB',
      reason: payload,
      impact: payload
    })

    expect(li.querySelector('.item-name')?.textContent).toBe(payload)
    expect(li.querySelector('.item-name')?.innerHTML).not.toContain('<img')
    expect(li.querySelector('.item-path')?.textContent).toContain(payload)
    expect(li.querySelector('.item-path')?.innerHTML).not.toContain('<img')
    expect(li.querySelector('.item-desc')?.textContent).toContain(payload)
    expect(li.querySelector('img')).toBeNull()
  })
})
