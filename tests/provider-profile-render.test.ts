// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createProfileCard } from '../src/renderer/provider-profile-render'
import type { ProviderProfilePublic } from '../src/shared/provider-types'

const profile: ProviderProfilePublic = {
  id: 'profile-1',
  name: '我的 DeepSeek <script>',
  providerId: 'deepseek',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  hasKey: true,
  keyLastFour: '1234',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const otherProfile: ProviderProfilePublic = {
  ...profile,
  id: 'profile-2',
  name: 'OpenAI',
  providerId: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  isActive: false
}

describe('provider profile render', () => {
  it('renders profile fields with textContent only', () => {
    const card = createProfileCard(profile, {
      onUse: () => {},
      onEdit: () => {},
      onTestConnection: () => {},
      onTestCapability: () => {},
      onDelete: () => {},
      testingProfileIds: new Set(),
      lastTestStatus: new Map()
    })

    expect(card.innerHTML).not.toContain('<script>')
    expect(card.textContent).toContain('我的 DeepSeek <script>')
    expect(card.textContent).toContain('deepseek-chat')
    expect(card.textContent).toContain('****1234')
    expect(card.textContent).toContain('当前使用')
  })

  it('shows persisted test status after testing completes', () => {
    const lastTestStatus = new Map([
      [profile.id, { message: '连接成功（42 ms）', tone: 'success' as const }]
    ])
    const card = createProfileCard(profile, {
      onUse: () => {},
      onEdit: () => {},
      onTestConnection: () => {},
      onTestCapability: () => {},
      onDelete: () => {},
      testingProfileIds: new Set(),
      lastTestStatus
    })

    const status = card.querySelector('.provider-status')
    expect(status?.textContent).toBe('连接成功（42 ms）')
    expect(status?.getAttribute('data-tone')).toBe('success')
  })

  it('only locks the profile currently being tested', () => {
    const testing = createProfileCard(profile, {
      onUse: () => {},
      onEdit: () => {},
      onTestConnection: () => {},
      onTestCapability: () => {},
      onDelete: () => {},
      testingProfileIds: new Set([profile.id]),
      lastTestStatus: new Map([[profile.id, { message: '正在测试连接…', tone: 'neutral' }]])
    })
    const idle = createProfileCard(otherProfile, {
      onUse: () => {},
      onEdit: () => {},
      onTestConnection: () => {},
      onTestCapability: () => {},
      onDelete: () => {},
      testingProfileIds: new Set([profile.id]),
      lastTestStatus: new Map()
    })

    const testingButtons = [...testing.querySelectorAll('button')]
    const idleButtons = [...idle.querySelectorAll('button')]

    expect(testingButtons.find((btn) => btn.textContent === '测试中…')).toBeTruthy()
    expect(testingButtons.find((btn) => btn.textContent === '编辑')?.disabled).toBe(true)
    expect(testingButtons.find((btn) => btn.textContent === '删除')?.disabled).toBe(true)
    expect(testingButtons.find((btn) => btn.textContent === '当前使用')?.disabled).toBe(true)
    expect(idleButtons.find((btn) => btn.textContent === '使用此配置')?.disabled).toBe(false)
    expect(idleButtons.find((btn) => btn.textContent === '编辑')?.disabled).toBe(false)
    expect(idleButtons.find((btn) => btn.textContent === '删除')?.disabled).toBe(false)
    expect(idleButtons.find((btn) => btn.textContent === '测试连接')?.disabled).toBe(false)
  })
})
