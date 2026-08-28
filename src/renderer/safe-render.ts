import type { DiscoverySource } from '../shared/types'

export interface EvidenceRenderItem {
  source: DiscoverySource
  sourceLabel: string
  summary: string
}

export interface ScanItemRenderInput {
  fileName: string
  path: string
  typeLabel: string
  sizeLabel: string
  sizeCaption?: string
  reason?: string
  impact?: string
  judgmentLabel?: string
  judgmentClass?: string
  originLabel?: string
  sourceLabel?: string
  briefReason?: string
  riskSummary?: string
  cleanupEligibility?: string
  agentReviewSummary?: string
  safetyCheckSummary?: string
  impactSummary?: string
  appClosedWarning?: string
  notSelectableReason?: string
  agentLikelyContent?: string
  agentReason?: string
  agentImpact?: string
  agentConfidenceLabel?: string
  evidenceItems?: EvidenceRenderItem[]
  /** 测试用：执行快照字节数 */
  executionSizeBytes?: number
  /** 测试用：空间观察字节数 */
  occupancySizeBytes?: number
}

const MAX_VISIBLE_EVIDENCE = 12

function appendDetailRows(parent: HTMLElement, lines: string[]): void {
  for (const line of lines) {
    const row = document.createElement('div')
    row.className = 'item-desc'
    row.textContent = line
    parent.appendChild(row)
  }
}

export function createScanItemElement(input: ScanItemRenderInput): HTMLLIElement {
  const li = document.createElement('li')
  li.className = 'item'

  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.dataset.role = 'cleanup'

  const info = document.createElement('div')
  info.className = 'item-info'

  const nameRow = document.createElement('div')
  nameRow.className = 'item-name-row'

  const nameEl = document.createElement('div')
  nameEl.className = 'item-name'
  nameEl.textContent = input.fileName

  nameRow.appendChild(nameEl)

  if (input.sourceLabel) {
    const source = document.createElement('span')
    source.className = 'judgment-source-badge'
    source.textContent = input.sourceLabel
    nameRow.appendChild(source)
  } else if (input.originLabel) {
    const origin = document.createElement('span')
    origin.className = 'judgment-origin-badge'
    origin.textContent = input.originLabel
    nameRow.appendChild(origin)
  }

  if (input.judgmentLabel) {
    const badge = document.createElement('span')
    badge.className = `judgment-badge ${input.judgmentClass ?? ''}`.trim()
    badge.textContent = input.judgmentLabel
    nameRow.appendChild(badge)
  }

  const pathBtn = document.createElement('button')
  pathBtn.type = 'button'
  pathBtn.className = 'item-path'
  pathBtn.title = '在资源管理器中打开'
  pathBtn.textContent = input.path

  const typeEl = document.createElement('div')
  typeEl.className = 'item-type'
  typeEl.textContent = input.typeLabel

  info.append(nameRow, pathBtn, typeEl)

  if (input.briefReason) {
    const reasonEl = document.createElement('div')
    reasonEl.className = 'item-desc item-brief-reason'
    reasonEl.textContent = input.briefReason
    info.appendChild(reasonEl)
  } else if (input.reason) {
    const reasonEl = document.createElement('div')
    reasonEl.className = 'item-desc item-brief-reason'
    reasonEl.textContent = input.reason
    info.appendChild(reasonEl)
  }

  if (input.riskSummary) {
    const riskEl = document.createElement('div')
    riskEl.className = 'item-desc item-risk'
    riskEl.textContent = input.riskSummary
    info.appendChild(riskEl)
  }

  const detailLines = [
    input.cleanupEligibility,
    input.appClosedWarning,
    input.agentReviewSummary,
    input.safetyCheckSummary,
    input.impactSummary,
    input.agentLikelyContent ? `可能内容：${input.agentLikelyContent}` : undefined,
    input.agentReason ? `分析理由：${input.agentReason}` : undefined,
    input.agentImpact ? `影响：${input.agentImpact}` : undefined,
    input.agentConfidenceLabel ? `置信度：${input.agentConfidenceLabel}` : undefined
  ].filter(Boolean) as string[]

  const hasEvidence = Boolean(input.evidenceItems && input.evidenceItems.length > 0)
  const hasDetails = detailLines.length > 0 || hasEvidence

  if (hasDetails) {
    const details = document.createElement('details')
    details.className = 'item-details'

    const summary = document.createElement('summary')
    summary.textContent = '查看详情'
    details.appendChild(summary)

    const body = document.createElement('div')
    body.className = 'item-details-body'
    appendDetailRows(body, detailLines)

    if (hasEvidence && input.evidenceItems) {
      const evidenceBlock = document.createElement('div')
      evidenceBlock.className = 'item-evidence'

      const title = document.createElement('div')
      title.className = 'item-evidence-title'
      title.textContent = '技术依据'
      evidenceBlock.appendChild(title)

      const list = document.createElement('ul')
      list.className = 'item-evidence-list'
      for (const entry of input.evidenceItems.slice(0, MAX_VISIBLE_EVIDENCE)) {
        const row = document.createElement('li')
        row.className = 'item-evidence-row'
        const source = document.createElement('span')
        source.className = 'item-evidence-source'
        source.textContent = entry.sourceLabel
        const summaryText = document.createElement('span')
        summaryText.className = 'item-evidence-summary'
        summaryText.textContent = entry.summary
        row.append(source, summaryText)
        list.appendChild(row)
      }
      if (input.evidenceItems.length > MAX_VISIBLE_EVIDENCE) {
        const more = document.createElement('li')
        more.className = 'item-evidence-more'
        more.textContent = `另有 ${input.evidenceItems.length - MAX_VISIBLE_EVIDENCE} 条依据`
        list.appendChild(more)
      }
      evidenceBlock.appendChild(list)
      body.appendChild(evidenceBlock)
    }

    details.appendChild(body)
    info.appendChild(details)
  }

  if (input.notSelectableReason) {
    const reasonEl = document.createElement('div')
    reasonEl.className = 'item-desc item-not-selectable'
    reasonEl.textContent = input.notSelectableReason
    info.appendChild(reasonEl)
  } else if (input.impact && !input.riskSummary) {
    const impactEl = document.createElement('div')
    impactEl.className = 'item-desc'
    impactEl.textContent = `影响：${input.impact}`
    info.appendChild(impactEl)
  }

  const sizeEl = document.createElement('span')
  sizeEl.className = 'item-size'

  if (input.sizeCaption) {
    const caption = document.createElement('span')
    caption.className = 'item-size-caption'
    caption.textContent = input.sizeCaption
    sizeEl.appendChild(caption)
  }

  const value = document.createElement('span')
  value.className = 'item-size-value'
  value.textContent = input.sizeLabel
  sizeEl.appendChild(value)

  li.append(checkbox, info, sizeEl)
  return li
}
