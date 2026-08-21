export interface ScanItemRenderInput {
  fileName: string
  path: string
  typeLabel: string
  sizeLabel: string
  reason?: string
  impact?: string
}

export function createScanItemElement(input: ScanItemRenderInput): HTMLLIElement {
  const li = document.createElement('li')
  li.className = 'item'

  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'

  const info = document.createElement('div')
  info.className = 'item-info'

  const nameEl = document.createElement('div')
  nameEl.className = 'item-name'
  nameEl.textContent = input.fileName

  const pathBtn = document.createElement('button')
  pathBtn.type = 'button'
  pathBtn.className = 'item-path'
  pathBtn.title = '在资源管理器中打开'
  pathBtn.textContent = input.path

  const typeEl = document.createElement('div')
  typeEl.className = 'item-type'
  typeEl.textContent = input.typeLabel

  info.append(nameEl, pathBtn, typeEl)

  if (input.reason) {
    const reasonEl = document.createElement('div')
    reasonEl.className = 'item-desc'
    reasonEl.textContent = input.reason
    info.appendChild(reasonEl)
  }

  if (input.impact) {
    const impactEl = document.createElement('div')
    impactEl.className = 'item-desc'
    impactEl.textContent = `影响：${input.impact}`
    info.appendChild(impactEl)
  }

  const sizeEl = document.createElement('span')
  sizeEl.className = 'item-size'
  sizeEl.textContent = input.sizeLabel

  li.append(checkbox, info, sizeEl)
  return li
}
