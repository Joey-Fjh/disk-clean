import type { ProviderProfilePublic } from '../shared/provider-types'
import { formatProfileOrigin, presetLabel } from './provider-form-state'
import type { ProfileTestStatus } from './provider-test-state'

export type { ProfileTestStatus }

export function createProfileMetaRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'provider-profile-meta-row'
  const dt = document.createElement('span')
  dt.className = 'provider-profile-meta-label'
  dt.textContent = label
  const dd = document.createElement('span')
  dd.className = 'provider-profile-meta-value'
  dd.textContent = value
  row.append(dt, dd)
  return row
}

export function createProfileCard(
  profile: ProviderProfilePublic,
  options: {
    onUse: (profileId: string) => void
    onEdit: (profileId: string) => void
    onTestConnection: (profileId: string) => void
    onTestCapability: (profileId: string) => void
    onDelete: (profileId: string, name: string) => void
    testingProfileIds: ReadonlySet<string>
    lastTestStatus: ReadonlyMap<string, ProfileTestStatus>
  }
): HTMLElement {
  const card = document.createElement('article')
  card.className = 'provider-profile-card'
  card.dataset.profileId = profile.id

  const isTesting = options.testingProfileIds.has(profile.id)
  const savedStatus = options.lastTestStatus.get(profile.id)

  const header = document.createElement('div')
  header.className = 'provider-profile-card-header'

  const title = document.createElement('h4')
  title.className = 'provider-profile-card-title'
  title.textContent = profile.name

  header.appendChild(title)

  if (profile.isActive) {
    const badge = document.createElement('span')
    badge.className = 'provider-profile-badge'
    badge.textContent = '当前使用'
    header.appendChild(badge)
  }

  const meta = document.createElement('div')
  meta.className = 'provider-profile-meta'
  meta.append(
    createProfileMetaRow('Provider', presetLabel(profile.providerId)),
    createProfileMetaRow('模型', profile.model || '—'),
    createProfileMetaRow('Origin', formatProfileOrigin(profile.baseUrl)),
    createProfileMetaRow(
      'API Key',
      profile.hasKey ? `已配置 · ****${profile.keyLastFour ?? '????'}` : '未配置'
    )
  )

  const actions = document.createElement('div')
  actions.className = 'provider-profile-actions'

  const useBtn = document.createElement('button')
  useBtn.type = 'button'
  useBtn.className = 'btn btn-secondary btn-sm'
  useBtn.textContent = profile.isActive ? '当前使用' : '使用此配置'
  useBtn.disabled = profile.isActive || isTesting
  useBtn.addEventListener('click', () => options.onUse(profile.id))

  const editBtn = document.createElement('button')
  editBtn.type = 'button'
  editBtn.className = 'btn btn-secondary btn-sm'
  editBtn.textContent = '编辑'
  editBtn.disabled = isTesting
  editBtn.addEventListener('click', () => options.onEdit(profile.id))

  const testConnBtn = document.createElement('button')
  testConnBtn.type = 'button'
  testConnBtn.className = 'btn btn-secondary btn-sm'
  testConnBtn.textContent = isTesting ? '测试中…' : '测试连接'
  testConnBtn.disabled = !profile.hasKey || isTesting
  testConnBtn.addEventListener('click', () => options.onTestConnection(profile.id))

  const testCapBtn = document.createElement('button')
  testCapBtn.type = 'button'
  testCapBtn.className = 'btn btn-secondary btn-sm'
  testCapBtn.textContent = isTesting ? '测试中…' : '能力测试'
  testCapBtn.disabled = !profile.hasKey || isTesting
  testCapBtn.addEventListener('click', () => options.onTestCapability(profile.id))

  const deleteBtn = document.createElement('button')
  deleteBtn.type = 'button'
  deleteBtn.className = 'btn btn-secondary btn-sm provider-profile-delete'
  deleteBtn.textContent = '删除'
  deleteBtn.disabled = isTesting
  deleteBtn.addEventListener('click', () => options.onDelete(profile.id, profile.name))

  actions.append(useBtn, editBtn, testConnBtn, testCapBtn, deleteBtn)

  card.append(header, meta, actions)

  if (savedStatus) {
    const status = document.createElement('p')
    status.className = 'provider-status'
    status.textContent = savedStatus.message
    status.dataset.tone = savedStatus.tone
    card.appendChild(status)
  }

  return card
}

export function renderProfileList(
  container: HTMLElement,
  profiles: ProviderProfilePublic[],
  options: Parameters<typeof createProfileCard>[1]
): void {
  container.replaceChildren()
  if (profiles.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'provider-empty-state'
    const text = document.createElement('p')
    text.textContent = '尚未保存任何模型配置'
    const addBtn = document.createElement('button')
    addBtn.type = 'button'
    addBtn.className = 'btn btn-primary'
    addBtn.id = 'provider-empty-add-btn'
    addBtn.textContent = '添加模型配置'
    addBtn.addEventListener('click', () => options.onEdit(''))
    empty.append(text, addBtn)
    container.appendChild(empty)
    return
  }

  for (const profile of profiles) {
    container.appendChild(createProfileCard(profile, options))
  }
}
