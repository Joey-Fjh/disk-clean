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

const MAX_VISIBLE_EVIDENCE = 4

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

  if (input.originLabel) {
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

  if (input.reason) {
    const reasonEl = document.createElement('div')
    reasonEl.className = 'item-desc'
    reasonEl.textContent = input.reason
    info.appendChild(reasonEl)
  }

  const summaryBlock = document.createElement('div')
  summaryBlock.className = 'item-judgment-summary'
  for (const line of [
    input.cleanupEligibility,
    input.appClosedWarning,
    input.agentReviewSummary,
    input.safetyCheckSummary,
    input.impactSummary
  ].filter(Boolean) as string[]) {
    const row = document.createElement('div')
    row.className = 'item-desc'
    row.textContent = line
    summaryBlock.appendChild(row)
  }
  if (summaryBlock.childElementCount > 0) {
    info.appendChild(summaryBlock)
  }

  if (input.agentLikelyContent) {
    const agentBlock = document.createElement('div')
    agentBlock.className = 'item-agent-insight'

    const title = document.createElement('div')
    title.className = 'item-agent-title'
    title.textContent = 'Agent 建议'
    agentBlock.appendChild(title)

    const likely = document.createElement('div')
    likely.className = 'item-desc'
    likely.textContent = `可能内容：${input.agentLikelyContent}`
    agentBlock.appendChild(likely)

    if (input.agentReason) {
      const reason = document.createElement('div')
      reason.className = 'item-desc'
      reason.textContent = `理由：${input.agentReason}`
      agentBlock.appendChild(reason)
    }

    if (input.agentImpact) {
      const impact = document.createElement('div')
      impact.className = 'item-desc'
      impact.textContent = `影响：${input.agentImpact}`
      agentBlock.appendChild(impact)
    }

    if (input.agentConfidenceLabel) {
      const confidence = document.createElement('div')
      confidence.className = 'item-desc item-agent-confidence'
      confidence.textContent = `置信度：${input.agentConfidenceLabel} · 来源：Agent`
      agentBlock.appendChild(confidence)
    }

    info.appendChild(agentBlock)
  }

  if (input.evidenceItems && input.evidenceItems.length > 0) {
    const evidenceBlock = document.createElement('div')
    evidenceBlock.className = 'item-evidence'

    const title = document.createElement('div')
    title.className = 'item-evidence-title'
    title.textContent = '判断依据'
    evidenceBlock.appendChild(title)

    const list = document.createElement('ul')
    list.className = 'item-evidence-list'

    const visible = input.evidenceItems.slice(0, MAX_VISIBLE_EVIDENCE)
    for (const entry of visible) {
      const row = document.createElement('li')
      row.className = 'item-evidence-row'

      const source = document.createElement('span')
      source.className = 'item-evidence-source'
      source.textContent = entry.sourceLabel

      const summary = document.createElement('span')
      summary.className = 'item-evidence-summary'
      summary.textContent = entry.summary

      row.append(source, summary)
      list.appendChild(row)
    }

    if (input.evidenceItems.length > MAX_VISIBLE_EVIDENCE) {
      const more = document.createElement('li')
      more.className = 'item-evidence-more'
      more.textContent = `另有 ${input.evidenceItems.length - MAX_VISIBLE_EVIDENCE} 条依据`
      list.appendChild(more)
    }

    evidenceBlock.appendChild(list)
    info.appendChild(evidenceBlock)
  }

  if (input.notSelectableReason) {
    const reasonEl = document.createElement('div')
    reasonEl.className = 'item-desc item-not-selectable'
    reasonEl.textContent = input.notSelectableReason
    info.appendChild(reasonEl)
  } else if (input.impact) {
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
