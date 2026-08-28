/// <reference path="../preload/index.d.ts" />
import type {
  CoreSafetyPolicy,
  RuleDraftPreviewResult,
  RulePackManifest,
  StoredRuleDraft
} from '../shared/rule-layer-types'
import type { RuleConfig } from '../shared/types'
import { CANDIDATE_TAB_LABELS, CONTENT_TYPE_LABELS } from '../shared/types'
import { CLEANUP_DISPLAY_CATEGORY_LABELS } from '../shared/cleanup-display-category'
import { formatBytes } from '../shared/format-bytes'

const DRAFT_USER_STATUS_LABELS: Record<string, string> = {
  draft: '待确认',
  validated: '待确认',
  previewed: '待确认',
  approved: '待确认',
  enabled: '已启用',
  disabled: '已停用',
  rejected: '已拒绝',
  retired: '已退役'
}

const DRAFT_BADGE_CLASS: Record<string, string> = {
  draft: 'draft-badge-pending',
  validated: 'draft-badge-pending',
  previewed: 'draft-badge-pending',
  approved: 'draft-badge-pending',
  enabled: 'draft-badge-enabled',
  disabled: 'draft-badge-disabled',
  rejected: 'draft-badge-disabled',
  retired: 'draft-badge-disabled'
}

function getUserDraftStatus(status: StoredRuleDraft['status']): string {
  return DRAFT_USER_STATUS_LABELS[status] ?? status
}

function getDraftBadgeClass(status: StoredRuleDraft['status']): string {
  return DRAFT_BADGE_CLASS[status] ?? 'draft-badge-pending'
}

const ORIGIN_LABELS: Record<string, string> = {
  official: '官方',
  'user-import': '用户导入',
  'agent-generated': 'Agent 生成',
  'legacy-user': '旧版迁移'
}

type RulePackListItem = RulePackManifest & { enabled: boolean; ruleCount: number }

let postEnableDraftId: string | null = null

export function isPostEnableNoticeVisible(): boolean {
  const container = document.getElementById('rule-draft-post-enable')
  return postEnableDraftId !== null && container !== null && !container.hidden
}

export function dismissPostEnableNotice(): void {
  postEnableDraftId = null
  const container = document.getElementById('rule-draft-post-enable')
  if (container) {
    container.hidden = true
    container.replaceChildren()
  }
}

function syncPostEnableNotice(drafts: StoredRuleDraft[]): void {
  if (!postEnableDraftId) return
  const record = drafts.find((draft) => draft.id === postEnableDraftId)
  if (!record || record.status !== 'enabled') {
    dismissPostEnableNotice()
  }
}

export function triggerPostEnableRescan(): void {
  dismissPostEnableNotice()
  document.querySelector<HTMLButtonElement>('.tab[data-tab="clean"]')?.click()
  window.dispatchEvent(new CustomEvent('diskclean:trigger-rescan'))
}

export function renderPostEnableNotice(): void {
  const container = document.getElementById('rule-draft-post-enable')
  const status = document.getElementById('rule-drafts-status')
  if (!container || !postEnableDraftId) return

  container.hidden = false
  container.replaceChildren()

  const message = document.createElement('p')
  message.className = 'rule-post-enable-message'
  setText(message, '规则已启用，需要重新扫描后才能更新清理结果。')

  const actions = document.createElement('div')
  actions.className = 'rule-post-enable-actions'

  const rescanBtn = document.createElement('button')
  rescanBtn.className = 'btn btn-primary'
  rescanBtn.type = 'button'
  rescanBtn.textContent = '重新扫描并查看结果'
  rescanBtn.addEventListener('click', () => {
    triggerPostEnableRescan()
  })

  const laterBtn = document.createElement('button')
  laterBtn.className = 'btn btn-secondary'
  laterBtn.type = 'button'
  laterBtn.textContent = '稍后扫描'
  laterBtn.addEventListener('click', () => {
    dismissPostEnableNotice()
    if (status) status.textContent = '规则已启用。下次扫描时将使用新规则。'
  })

  actions.append(rescanBtn, laterBtn)
  container.append(message, actions)
  if (status) status.textContent = '规则已启用，需要重新扫描后才能更新清理结果。'
}

export async function handleRuleDraftEnabled(draftId: string): Promise<void> {
  postEnableDraftId = draftId
  await loadRuleKnowledgeSettings()
  renderPostEnableNotice()
}

function setText(el: HTMLElement, text: string): void {
  el.textContent = text
}

function renderEmpty(list: HTMLElement, message: string): void {
  list.replaceChildren()
  const empty = document.createElement('div')
  empty.className = 'rules-empty'
  setText(empty, message)
  list.appendChild(empty)
}

export function formatRuleKnowledgeSummary(
  packs: Array<{ enabled: boolean }>,
  drafts: StoredRuleDraft[]
): string {
  const enabledPacks = packs.filter((pack) => pack.enabled).length
  const pendingDrafts = drafts.filter((draft) =>
    ['validated', 'previewed', 'draft'].includes(draft.status)
  ).length
  return `规则包 ${enabledPacks}/${packs.length} · 待确认扩展规则 ${pendingDrafts}`
}

export async function loadRuleKnowledgeSettings(): Promise<void> {
  const [packs, drafts, safety] = await Promise.all([
    window.diskClean.listRulePacks(),
    window.diskClean.listRuleDrafts(),
    window.diskClean.getSafetyPolicy()
  ])

  const summary = document.getElementById('rules-card-summary')
  if (summary) summary.textContent = formatRuleKnowledgeSummary(packs, drafts)

  syncPostEnableNotice(drafts)

  renderRulePacks(packs)
  renderRuleDrafts(drafts)
  renderSafetyPolicy(safety)
}

function renderRulePacks(packs: RulePackListItem[]): void {
  const list = document.getElementById('rule-packs-list')
  const status = document.getElementById('rule-packs-status')
  if (!list) return

  list.replaceChildren()
  if (packs.length === 0) {
    renderEmpty(list, '暂无规则包')
    return
  }

  for (const pack of packs) {
    const row = document.createElement('div')
    row.className = `rule-item${pack.enabled ? '' : ' disabled'}`

    const main = document.createElement('div')
    main.className = 'rule-item-main'
    const nameEl = document.createElement('div')
    nameEl.className = 'rule-item-name'
    setText(nameEl, pack.name)
    const metaEl = document.createElement('div')
    metaEl.className = 'rule-item-meta'
    const summaryParts = [
      ORIGIN_LABELS[pack.origin] ?? pack.origin,
      `v${pack.version}`,
      pack.enabled ? '已启用' : '已停用',
      `${pack.ruleCount} 条规则`
    ]
    if (pack.description) summaryParts.push(pack.description)
    setText(metaEl, summaryParts.join(' · '))
    main.append(nameEl, metaEl)

    if (pack.rules.length > 0) {
      const details = document.createElement('details')
      details.className = 'rule-pack-details'
      const summary = document.createElement('summary')
      setText(summary, `查看包内 ${pack.rules.length} 条规则摘要`)
      details.appendChild(summary)
      details.appendChild(renderRulePackRules(pack.rules))
      main.appendChild(details)
    }

    const actions = document.createElement('div')
    actions.className = 'rule-item-actions'
    const toggleLabel = document.createElement('label')
    toggleLabel.className = 'rule-toggle'
    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.checked = pack.enabled
    toggleLabel.append(toggle, document.createElement('span'))
    actions.appendChild(toggleLabel)
    row.append(main, actions)

    toggle.addEventListener('change', async () => {
      await window.diskClean.setRulePackEnabled(pack.id, toggle.checked)
      await loadRuleKnowledgeSettings()
      if (status) {
        status.textContent = toggle.checked ? `已启用：${pack.name}` : `已禁用：${pack.name}`
      }
    })

    list.appendChild(row)
  }

  if (status) status.textContent = `共 ${packs.length} 个规则包`
}

function formatRuleScopeSummary(rule: RuleConfig): string {
  const parts: string[] = []
  if (rule.paths.length > 0) parts.push(`base：${rule.paths.join(', ')}`)
  if (rule.subdirs?.length) parts.push(`subdirs：${rule.subdirs.join(', ')}`)
  if (rule.globDirs?.length) parts.push(`globDirs：${rule.globDirs.join(', ')}`)
  if (rule.patterns?.length) parts.push(`patterns：${rule.patterns.join(', ')}`)
  return parts.join(' · ') || '（无范围摘要）'
}

function renderRulePackRules(rules: RuleConfig[]): HTMLElement {
  const list = document.createElement('div')
  list.className = 'rule-pack-rules'

  for (const rule of rules) {
    const card = document.createElement('div')
    card.className = 'rule-pack-rule-card'

    const title = document.createElement('div')
    title.className = 'rule-item-name'
    setText(title, rule.name)

    const lines = [
      `内容类型：${rule.contentType ? CONTENT_TYPE_LABELS[rule.contentType] : '未指定'}`,
      `风险分类：${CANDIDATE_TAB_LABELS[rule.category]}`,
      `判断原因：${rule.reason ?? rule.description ?? '—'}`,
      rule.impact ? `影响说明：${rule.impact}` : '',
      `允许清理：${rule.deletable === false ? '否' : '是'}`,
      `可重新生成：${rule.rebuildable === true ? '是' : '否'}`,
      rule.source ? `来源：${rule.source}` : '',
      rule.testedVersions?.length ? `适用版本：${rule.testedVersions.join(', ')}` : '',
      rule.requiresAppClosed ? '需要关闭相关软件' : '',
      rule.reviewStatus ? `审核状态：${rule.reviewStatus}` : '',
      `范围：${formatRuleScopeSummary(rule)}`
    ].filter(Boolean)

    card.appendChild(title)
    for (const line of lines) {
      const row = document.createElement('div')
      row.className = 'rule-item-meta'
      setText(row, line)
      card.appendChild(row)
    }

    const copyBtn = document.createElement('button')
    copyBtn.className = 'btn btn-link'
    copyBtn.type = 'button'
    copyBtn.textContent = '复制为我的规则'
    copyBtn.addEventListener('click', async () => {
      await window.diskClean.copyBuiltInRuleAsDraft(rule.id)
      await loadRuleKnowledgeSettings()
    })
    card.appendChild(copyBtn)

    list.appendChild(card)
  }

  return list
}

export function renderUserFacingRulePreview(
  preview: RuleDraftPreviewResult,
  draft: { name: string; reason: string }
): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'rule-preview-summary'

  const lines = [
    `规则名称：${draft.name}`,
    `会识别：${draft.reason}`,
    `当前匹配：${preview.matchCount} 项 · ${formatBytes(preview.estimatedBytes)}`,
    `风险等级：${preview.scope.suggestedRisk}`,
    `可重新生成：${preview.scope.rebuildable === true ? '是' : '否'}`,
    preview.protectedTargetCount > 0 ? `命中保护目录：${preview.protectedTargetCount} 个目标` : '未命中保护目录目标',
    preview.approvable ? '可以启用' : `不可启用：${preview.blockReason ?? '未知原因'}`
  ]

  for (const line of lines) {
    const row = document.createElement('div')
    row.className = 'rule-item-meta'
    setText(row, line)
    panel.appendChild(row)
  }

  if (preview.samples.length > 0) {
    const sampleTitle = document.createElement('div')
    sampleTitle.className = 'rule-item-meta'
    setText(sampleTitle, '匹配样本：')
    panel.appendChild(sampleTitle)
    for (const sample of preview.samples.slice(0, 5)) {
      const row = document.createElement('div')
      row.className = 'rule-item-meta'
      setText(row, `· ${sample.pathSummary} (${formatBytes(sample.size)})`)
      panel.appendChild(row)
    }
  }

  return panel
}

function renderRuleDraftEditForm(
  record: StoredRuleDraft,
  onSaved: () => void
): HTMLElement {
  const form = document.createElement('form')
  form.className = 'rule-draft-edit-form'

  const fields: Array<{ key: string; label: string; value: string; multiline?: boolean }> = [
    { key: 'name', label: '名称', value: record.draft.name },
    { key: 'reason', label: '说明', value: record.draft.reason, multiline: true },
    {
      key: 'basePlaceholders',
      label: '基础路径（每行一个占位符）',
      value: record.draft.basePlaceholders.join('\n'),
      multiline: true
    },
    {
      key: 'globDirs',
      label: '相对 glob（每行一个，可选）',
      value: (record.draft.globDirs ?? []).join('\n'),
      multiline: true
    },
    { key: 'suggestedRisk', label: '风险等级（safe/recommended/dangerous）', value: record.draft.suggestedRisk },
    {
      key: 'rebuildable',
      label: '可重建（true/false）',
      value: String(record.draft.rebuildable ?? false)
    },
    {
      key: 'requiresAppClosed',
      label: '需关闭软件（true/false）',
      value: String(record.draft.requiresAppClosed ?? false)
    },
    { key: 'impact', label: '影响说明', value: record.draft.impact ?? '', multiline: true }
  ]

  for (const field of fields) {
    const label = document.createElement('label')
    label.className = 'rule-edit-field'
    const title = document.createElement('span')
    setText(title, field.label)
    const input = field.multiline ? document.createElement('textarea') : document.createElement('input')
    input.name = field.key
    if (!field.multiline) (input as HTMLInputElement).type = 'text'
    input.value = field.value
    label.append(title, input)
    form.appendChild(label)
  }

  const saveBtn = document.createElement('button')
  saveBtn.type = 'submit'
  saveBtn.className = 'btn btn-primary'
  saveBtn.textContent = '保存并重新预览'
  form.appendChild(saveBtn)

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const data = new FormData(form)
    const baseLines = String(data.get('basePlaceholders') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const globLines = String(data.get('globDirs') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    try {
      await window.diskClean.updateRuleDraft(record.id, {
        name: String(data.get('name') ?? ''),
        reason: String(data.get('reason') ?? ''),
        basePlaceholders: baseLines,
        globDirs: globLines.length > 0 ? globLines : undefined,
        suggestedRisk: String(data.get('suggestedRisk') ?? 'recommended'),
        rebuildable: String(data.get('rebuildable') ?? 'false') === 'true',
        requiresAppClosed: String(data.get('requiresAppClosed') ?? 'false') === 'true',
        impact: String(data.get('impact') ?? '') || undefined
      })
      onSaved()
    } catch (error) {
      const status = document.getElementById('rule-drafts-status')
      if (status) status.textContent = error instanceof Error ? error.message : '保存失败'
    }
  })

  return form
}

function renderPreviewSummary(preview: RuleDraftPreviewResult, draft: StoredRuleDraft['draft']): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'rule-preview-summary'

  const lines = [
    `会识别：${draft.reason}`,
    `当前匹配：${preview.matchCount} 项 · ${formatBytes(preview.estimatedBytes)}`,
    `风险等级：${preview.scope.suggestedRisk}`,
    `可重新生成：${draft.rebuildable === true ? '是' : '否'}`,
    preview.protectedTargetCount > 0 ? `命中保护目录：${preview.protectedTargetCount} 个目标` : '未命中保护目录目标',
    preview.approvable ? '允许启用' : `不可启用：${preview.blockReason ?? '未知原因'}`
  ]

  for (const line of lines) {
    const row = document.createElement('div')
    row.className = 'rule-item-meta'
    setText(row, line)
    panel.appendChild(row)
  }

  if (preview.samples.length > 0) {
    const sampleTitle = document.createElement('div')
    sampleTitle.className = 'rule-item-meta'
    setText(sampleTitle, '脱敏样本：')
    panel.appendChild(sampleTitle)
    for (const sample of preview.samples) {
      const row = document.createElement('div')
      row.className = 'rule-item-meta'
      setText(row, `· ${sample.pathSummary} (${formatBytes(sample.size)})`)
      panel.appendChild(row)
    }
  }

  const details = document.createElement('details')
  details.className = 'rule-preview-technical'
  const summary = document.createElement('summary')
  setText(summary, '技术详情')
  details.appendChild(summary)
  details.appendChild(renderPreviewDetails(preview))
  panel.appendChild(details)

  return panel
}
function renderPreviewDetails(preview: RuleDraftPreviewResult): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'rule-preview-details'

  const lines: string[] = [
    `fingerprint：${preview.sessionFingerprint}`,
    `base：${preview.scope.basePlaceholders.join(', ')}`,
    preview.scope.subdirs?.length ? `subdirs：${preview.scope.subdirs.join(', ')}` : '',
    preview.scope.globDirs?.length ? `globDirs：${preview.scope.globDirs.join(', ')}` : '',
    preview.scope.relativePatterns?.length
      ? `patterns：${preview.scope.relativePatterns.join(', ')}`
      : '',
    `rebuildable：${String(preview.scope.rebuildable)}`,
    preview.warnings.length ? `warnings：${preview.warnings.join('；')}` : ''
  ].filter(Boolean)

  for (const line of lines) {
    const row = document.createElement('div')
    row.className = 'rule-item-meta'
    setText(row, line)
    panel.appendChild(row)
  }

  return panel
}

function renderRuleDrafts(drafts: StoredRuleDraft[]): void {
  const list = document.getElementById('rule-drafts-list')
  const status = document.getElementById('rule-drafts-status')
  if (!list) return

  list.replaceChildren()
  if (drafts.length === 0) {
    renderEmpty(list, '暂无扩展规则。扫描后可生成或导入 JSON。')
    return
  }

  for (const record of drafts) {
    const row = document.createElement('div')
    row.className = 'rule-item draft-item'
    const preview = record.preview
    const userStatus = getUserDraftStatus(record.status)

    const main = document.createElement('div')
    main.className = 'rule-item-main'
    const nameRow = document.createElement('div')
    nameRow.className = 'rule-item-name-row'
    const nameEl = document.createElement('div')
    nameEl.className = 'rule-item-name'
    setText(nameEl, record.draft.name)
    const badge = document.createElement('span')
    badge.className = `draft-status-badge ${getDraftBadgeClass(record.status)}`
    setText(badge, userStatus)
    nameRow.append(nameEl, badge)

    const metaEl = document.createElement('div')
    metaEl.className = 'rule-item-meta'
    setText(
      metaEl,
      [
        ORIGIN_LABELS[record.origin] ?? record.origin,
        preview
          ? `匹配 ${preview.matchCount} · ${formatBytes(preview.estimatedBytes)}`
          : '未预览'
      ].join(' · ')
    )
    const reasonEl = document.createElement('div')
    reasonEl.className = 'rule-item-meta'
    setText(reasonEl, record.draft.reason)
    main.append(nameRow, metaEl, reasonEl)
    if (preview) {
      main.appendChild(renderPreviewSummary(preview, record.draft))
    } else if (['draft', 'validated', 'previewed', 'approved'].includes(record.status)) {
      const hint = document.createElement('div')
      hint.className = 'rule-item-meta'
      setText(hint, '需要先完成一次扫描，才能确认这条规则会匹配哪些文件。')
      main.appendChild(hint)
    }

    const actions = document.createElement('div')
    actions.className = 'rule-item-actions rule-draft-actions'

    const previewBtn = document.createElement('button')
    previewBtn.className = 'btn btn-secondary'
    previewBtn.type = 'button'
    previewBtn.textContent = '基于当前扫描预览'
    previewBtn.addEventListener('click', async () => {
      const session = await window.diskClean.getActiveScanSession()
      if (!session) {
        if (status) status.textContent = '需要先完成一次扫描，才能确认这条规则会匹配哪些文件。'
        return
      }
      try {
        const result = await window.diskClean.previewRuleDraft(record.id, session.sessionId)
        if (status) {
          status.textContent = result.approvable
            ? `预览完成：匹配 ${result.matchCount} 项 · 可启用`
            : `预览完成：不可启用 — ${result.blockReason ?? '范围或安全校验未通过'}`
        }
        await loadRuleKnowledgeSettings()
      } catch (error) {
        if (status) {
          status.textContent = error instanceof Error ? error.message : '预览失败'
        }
      }
    })
    actions.appendChild(previewBtn)

    if (record.status !== 'enabled') {
      const editBtn = document.createElement('button')
      editBtn.className = 'btn btn-secondary'
      editBtn.type = 'button'
      editBtn.textContent = '编辑'
      const editHost = document.createElement('div')
      editHost.className = 'rule-draft-edit-host'
      editHost.hidden = true
      editBtn.addEventListener('click', () => {
        editHost.hidden = !editHost.hidden
        if (!editHost.hidden && editHost.childElementCount === 0) {
          editHost.appendChild(
            renderRuleDraftEditForm(record, async () => {
              if (status) status.textContent = '规则已更新，请重新预览后再启用。'
              await loadRuleKnowledgeSettings()
            })
          )
        }
      })
      actions.appendChild(editBtn)
      main.appendChild(editHost)
    }

    if (!preview) {
      const gotoScanBtn = document.createElement('button')
      gotoScanBtn.className = 'btn btn-link'
      gotoScanBtn.type = 'button'
      gotoScanBtn.textContent = '前往扫描'
      gotoScanBtn.addEventListener('click', () => {
        document.querySelector<HTMLButtonElement>('.tab[data-tab="clean"]')?.click()
      })
      actions.appendChild(gotoScanBtn)
    }

    if (['validated', 'previewed', 'approved', 'draft'].includes(record.status) && preview?.approvable) {
      const enableBtn = document.createElement('button')
      enableBtn.className = 'btn btn-primary'
      enableBtn.type = 'button'
      enableBtn.textContent = '启用规则'
      enableBtn.addEventListener('click', async () => {
        const result = await window.diskClean.confirmEnableRuleDraft(record.id)
        if (!result.ok) {
          if (status) status.textContent = result.message
          return
        }
        await handleRuleDraftEnabled(record.id)
      })
      actions.appendChild(enableBtn)
    }

    if (record.status === 'enabled') {
      const disableBtn = document.createElement('button')
      disableBtn.className = 'btn btn-secondary'
      disableBtn.type = 'button'
      disableBtn.textContent = '停用'
      disableBtn.addEventListener('click', async () => {
        await window.diskClean.disableRuleDraft(record.id)
        if (postEnableDraftId === record.id) {
          dismissPostEnableNotice()
        }
        if (status) status.textContent = '规则已停用，下次扫描时将不再使用。当前结果不会立即变化。'
        await loadRuleKnowledgeSettings()
      })
      actions.appendChild(disableBtn)
    }

    if (record.status === 'disabled') {
      const enableBtn = document.createElement('button')
      enableBtn.className = 'btn btn-secondary'
      enableBtn.type = 'button'
      enableBtn.textContent = '重新启用'
      enableBtn.addEventListener('click', async () => {
        const result = await window.diskClean.enableRuleDraft(record.id)
        if (!result.ok) {
          if (status) status.textContent = result.message
          return
        }
        if (result.code === 'ENABLED_NEEDS_RESCAN') {
          await handleRuleDraftEnabled(record.id)
        } else {
          await loadRuleKnowledgeSettings()
        }
      })
      actions.appendChild(enableBtn)
    }

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'rule-delete'
    deleteBtn.type = 'button'
    deleteBtn.textContent = '删除'
    deleteBtn.addEventListener('click', async () => {
      if (postEnableDraftId === record.id) {
        dismissPostEnableNotice()
      }
      await window.diskClean.deleteRuleDraft(record.id)
      await loadRuleKnowledgeSettings()
      if (status) status.textContent = '扩展规则已删除'
    })
    actions.appendChild(deleteBtn)

    row.append(main, actions)
    list.appendChild(row)
  }

  if (status && !postEnableDraftId) {
    status.textContent = `共 ${drafts.length} 条扩展规则（启用后仅影响后续扫描）`
  }

  if (postEnableDraftId) {
    renderPostEnableNotice()
  }
}

function renderSafetyPolicy(policy: CoreSafetyPolicy): void {
  const list = document.getElementById('safety-policy-list')
  if (!list) return
  list.replaceChildren()

  const items = [
    ...policy.constraints,
    `受保护路径条目：${policy.protectedPaths.length}（只读，不可编辑）`
  ]

  for (const text of items) {
    const row = document.createElement('div')
    row.className = 'safety-policy-item'
    setText(row, text)
    list.appendChild(row)
  }
}

export function wireRuleKnowledgeSettings(): void {
  const importDraftBtn = document.getElementById('import-rule-draft-btn')
  importDraftBtn?.addEventListener('click', async () => {
    const result = await window.diskClean.importRuleDraft()
    const status = document.getElementById('rule-drafts-status')
    if (result.imported && result.draft) {
      const session = await window.diskClean.getActiveScanSession()
      if (session) {
        try {
          await refreshRuleDraftPreview(result.draft.id, session.sessionId)
        } catch {
          // preview failure leaves draft in pending state
        }
      }
      if (status) {
        status.textContent = session
          ? '已导入为待确认规则，并已尝试基于当前扫描预览'
          : '已导入为待确认规则。需要先完成一次扫描，才能确认匹配范围。'
      }
    } else if (status) {
      status.textContent = '未导入任何扩展规则'
    }
    await loadRuleKnowledgeSettings()
  })

  const rulesKnowledgeTabs = document.getElementById('rules-knowledge-tabs')
  rulesKnowledgeTabs?.querySelectorAll<HTMLButtonElement>('[data-rules-knowledge-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.rulesKnowledgeTab!
      rulesKnowledgeTabs.querySelectorAll<HTMLButtonElement>('[data-rules-knowledge-tab]').forEach((btn) => {
        const selected = btn.dataset.rulesKnowledgeTab === target
        btn.classList.toggle('active', selected)
        btn.setAttribute('aria-selected', String(selected))
        btn.tabIndex = selected ? 0 : -1
      })
      document.querySelectorAll<HTMLElement>('[data-rules-knowledge-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.rulesKnowledgePanel !== target
      })
    })
  })

  void loadRuleKnowledgeSettings()
}

export async function refreshRuleDraftPreview(
  draftId: string,
  sessionId: string
): Promise<RuleDraftPreviewResult> {
  return window.diskClean.previewRuleDraft(draftId, sessionId)
}
