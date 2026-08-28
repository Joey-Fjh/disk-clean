const DEFAULT_BATCH_SIZE = 48

export function appendDomInBatches<T>(
  container: HTMLElement,
  items: T[],
  renderItem: (item: T) => HTMLElement,
  options: { batchSize?: number; onBatch?: () => void } = {}
): () => void {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  let index = 0
  let cancelled = false

  function scheduleNext(): void {
    if (cancelled || index >= items.length) return
    const end = Math.min(index + batchSize, items.length)
    const fragment = document.createDocumentFragment()
    for (; index < end; index += 1) {
      fragment.appendChild(renderItem(items[index]))
    }
    container.appendChild(fragment)
    options.onBatch?.()
    if (index < items.length) {
      requestAnimationFrame(scheduleNext)
    }
  }

  scheduleNext()
  return () => {
    cancelled = true
  }
}
