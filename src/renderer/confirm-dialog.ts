export interface ConfirmOptions {
  title: string
  message: string
  details?: string[]
  confirmLabel?: string
  cancelLabel?: string
}

let lastFocus: HTMLElement | null = null

export function showConfirmDialog(options: ConfirmOptions): Promise<boolean> {
  const overlay = document.getElementById('confirm-overlay') as HTMLElement
  const titleEl = document.getElementById('confirm-title') as HTMLElement
  const messageEl = document.getElementById('confirm-message') as HTMLElement
  const detailsEl = document.getElementById('confirm-details') as HTMLElement
  const confirmBtn = document.getElementById('confirm-ok') as HTMLButtonElement
  const cancelBtn = document.getElementById('confirm-cancel') as HTMLButtonElement

  lastFocus = document.activeElement as HTMLElement | null
  titleEl.textContent = options.title
  messageEl.textContent = options.message
  detailsEl.replaceChildren()
  for (const line of options.details ?? []) {
    const li = document.createElement('li')
    li.textContent = line
    detailsEl.appendChild(li)
  }
  confirmBtn.textContent = options.confirmLabel ?? '确认清理'
  cancelBtn.textContent = options.cancelLabel ?? '取消'

  overlay.hidden = false
  confirmBtn.focus()

  return new Promise((resolve) => {
    const cleanup = (result: boolean): void => {
      overlay.hidden = true
      document.removeEventListener('keydown', onKey)
      confirmBtn.removeEventListener('click', onConfirm)
      cancelBtn.removeEventListener('click', onCancel)
      overlay.removeEventListener('click', onOverlay)
      lastFocus?.focus()
      resolve(result)
    }

    const onConfirm = (): void => cleanup(true)
    const onCancel = (): void => cleanup(false)
    const onOverlay = (event: MouseEvent): void => {
      if (event.target === overlay) cleanup(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cleanup(false)
    }

    confirmBtn.addEventListener('click', onConfirm)
    cancelBtn.addEventListener('click', onCancel)
    overlay.addEventListener('click', onOverlay)
    document.addEventListener('keydown', onKey)
  })
}
