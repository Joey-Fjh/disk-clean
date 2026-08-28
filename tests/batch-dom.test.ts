// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendDomInBatches } from '../src/renderer/batch-dom'

describe('appendDomInBatches', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cancel prevents duplicate append when patch runs before next frame', async () => {
    const container = document.createElement('ul')
    const frames: Array<() => void> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb as () => void)
      return frames.length
    })

    const cancel = appendDomInBatches(
      container,
      ['a', 'b', 'c', 'd'],
      (id) => {
        const li = document.createElement('li')
        li.textContent = id
        li.dataset.itemId = id
        return li
      },
      { batchSize: 2 }
    )

    expect(container.children.length).toBe(2)
    cancel()
    frames[0]?.()
    expect(container.children.length).toBe(2)
    expect([...container.children].map((el) => el.textContent)).toEqual(['a', 'b'])
  })

  it('renders all items across multiple independent batch sessions', () => {
    const frames: Array<() => void> = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb as () => void)
      return frames.length
    })

    const listA = document.createElement('ul')
    const listB = document.createElement('ul')
    const itemsA = Array.from({ length: 60 }, (_, index) => `a-${index}`)
    const itemsB = Array.from({ length: 60 }, (_, index) => `b-${index}`)

    const cancels = new Set<() => void>()
    cancels.add(
      appendDomInBatches(
        listA,
        itemsA,
        (id) => {
          const li = document.createElement('li')
          li.dataset.itemId = id
          return li
        },
        { batchSize: 48 }
      )
    )
    cancels.add(
      appendDomInBatches(
        listB,
        itemsB,
        (id) => {
          const li = document.createElement('li')
          li.dataset.itemId = id
          return li
        },
        { batchSize: 48 }
      )
    )

    while (frames.length > 0) {
      const pending = frames.splice(0, frames.length)
      pending.forEach((frame) => frame())
    }

    expect(listA.querySelectorAll('[data-item-id]').length).toBe(60)
    expect(listB.querySelectorAll('[data-item-id]').length).toBe(60)

    const idsA = new Set([...listA.querySelectorAll('[data-item-id]')].map((el) => el.getAttribute('data-item-id')))
    const idsB = new Set([...listB.querySelectorAll('[data-item-id]')].map((el) => el.getAttribute('data-item-id')))
    expect(idsA.size).toBe(60)
    expect(idsB.size).toBe(60)
    for (const cancel of cancels) cancel()
  })
})
