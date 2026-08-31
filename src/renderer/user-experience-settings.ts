/// <reference path="../preload/index.d.ts" />
import type { UserExperienceEntry } from '../shared/user-experience-types'

const KIND_LABELS: Record<UserExperienceEntry['kind'], string> = {
  'keep-exclusion': '保留排除',
  'recognition-hint': '识别提示'
}

function describeMatcher(entry: UserExperienceEntry): string {
  const parts: string[] = []
  if (entry.matcher.softwareName) parts.push(`软件：${entry.matcher.softwareName}`)
  if (entry.matcher.contentType) parts.push(`类型：${entry.matcher.contentType}`)
  if (entry.matcher.relativePathSuffix) parts.push(`路径特征：…${entry.matcher.relativePathSuffix}`)
  if (entry.matcher.ruleId) parts.push(`规则：${entry.matcher.ruleId}`)
  return parts.join(' · ') || '通用匹配'
}

function renderExperienceList(entries: UserExperienceEntry[]): void {
  const list = document.getElementById('user-experience-list')
  const status = document.getElementById('user-experience-status')
  if (!list) return
  list.replaceChildren()

  if (entries.length === 0) {
    if (status) status.textContent = '还没有保存的经验。可在扫描结果中点击「以后保留此项」添加。'
    return
  }
  if (status) status.textContent = `共 ${entries.length} 条经验，重新扫描后生效。`

  for (const entry of entries) {
    const card = document.createElement('article')
    card.className = 'rule-draft-card'

    const title = document.createElement('h4')
    title.className = 'rule-draft-title'
    title.textContent = entry.name

    const meta = document.createElement('p')
    meta.className = 'rules-status'
    meta.textContent = `${KIND_LABELS[entry.kind]} · ${describeMatcher(entry)}`

    const reason = document.createElement('p')
    reason.className = 'item-desc'
    reason.textContent = entry.reason

    const actions = document.createElement('div')
    actions.className = 'rules-toolbar'

    const toggleBtn = document.createElement('button')
    toggleBtn.type = 'button'
    toggleBtn.className = 'btn btn-secondary'
    toggleBtn.textContent = entry.enabled ? '停用' : '启用'
    toggleBtn.addEventListener('click', async () => {
      await window.diskClean.updateUserExperience({ id: entry.id, enabled: !entry.enabled })
      await loadUserExperienceSettings()
    })

    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className = 'btn btn-secondary'
    deleteBtn.textContent = '删除'
    deleteBtn.addEventListener('click', async () => {
      await window.diskClean.deleteUserExperience(entry.id)
      await loadUserExperienceSettings()
    })

    actions.append(toggleBtn, deleteBtn)
    card.append(title, meta, reason, actions)
    list.appendChild(card)
  }
}

export async function loadUserExperienceSettings(): Promise<UserExperienceEntry[]> {
  const entries = await window.diskClean.listUserExperiences()
  renderExperienceList(entries)
  return entries
}

export function wireUserExperienceSettings(): void {
  void loadUserExperienceSettings()
}

export async function saveKeepExperienceForCandidate(candidateId: string): Promise<boolean> {
  const session = await window.diskClean.getScanSessionInfo()
  if (!session) return false
  await window.diskClean.createUserExperience({
    sessionId: session.sessionId,
    candidateId,
    kind: 'keep-exclusion',
    confirmed: true
  })
  return true
}
