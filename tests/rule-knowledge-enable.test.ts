// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredRuleDraft } from '../src/shared/rule-layer-types'
import {
  dismissPostEnableNotice,
  handleRuleDraftEnabled,
  isPostEnableNoticeVisible,
  loadRuleKnowledgeSettings,
  triggerPostEnableRescan
} from '../src/renderer/rule-knowledge-settings'

const preview = {
  sessionId: 'session-1',
  sessionFingerprint: 'session-1:100:0',
  matchCount: 1,
  ruleTargetCount: 1,
  estimatedBytes: 100,
  excludedProtectedCount: 0,
  protectedTargetCount: 0,
  drives: ['C:'],
  samples: [],
  warnings: [],
  approvable: true,
  scope: {
    basePlaceholders: ['%TEMP%'],
    subdirs: ['cache'],
    suggestedRisk: 'safe' as const,
    reason: 'cache'
  },
  previewedAt: '2026-01-01T00:00:00.000Z'
}

const draft: StoredRuleDraft = {
  id: 'draft-1',
  status: 'enabled',
  origin: 'user-import',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  sessionFingerprint: 'session-1:100:0',
  draft: {
    schemaVersion: '1',
    name: 'Cache draft',
    contentType: 'app-cache',
    basePlaceholders: ['%TEMP%'],
    subdirs: ['cache'],
    reason: 'cache',
    suggestedRisk: 'safe',
    source: 'user-import',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  preview
}

function setupDom(): void {
  document.body.innerHTML = `
    <span id="rules-card-summary"></span>
    <div id="rule-packs-list"></div>
    <p id="rule-packs-status"></p>
    <div id="rule-drafts-list"></div>
    <div id="rule-draft-post-enable" hidden></div>
    <p id="rule-drafts-status"></p>
    <div id="safety-policy-list"></div>
  `
}

describe('rule draft post-enable notice', () => {
  beforeEach(() => {
    setupDom()
    dismissPostEnableNotice()
    window.diskClean = {
      listRulePacks: vi.fn(async () => []),
      listRuleDrafts: vi.fn(async () => [draft]),
      getSafetyPolicy: vi.fn(async () => ({
        protectedPaths: [],
        protectedLabels: {},
        constraints: []
      })),
      confirmEnableRuleDraft: vi.fn(async () => ({
        ok: true,
        message: '规则已启用，需要重新扫描后才能更新清理结果。',
        code: 'ENABLED_NEEDS_RESCAN'
      }))
    } as unknown as typeof window.diskClean
  })

  afterEach(() => {
    dismissPostEnableNotice()
  })

  it('keeps rescan actions visible after list refresh', async () => {
    await handleRuleDraftEnabled('draft-1')

    expect(isPostEnableNoticeVisible()).toBe(true)
    expect(document.getElementById('rule-draft-post-enable')?.textContent).toContain(
      '重新扫描并查看结果'
    )
    expect(document.getElementById('rule-drafts-status')?.textContent).toContain(
      '需要重新扫描后才能更新清理结果'
    )
    expect(document.getElementById('rule-drafts-status')?.textContent).not.toContain('共 1 条扩展规则')
  })

  it('dismisses notice when user chooses later scan', async () => {
    await handleRuleDraftEnabled('draft-1')
    document.querySelector<HTMLButtonElement>('#rule-draft-post-enable .btn-secondary')?.click()
    expect(isPostEnableNoticeVisible()).toBe(false)
    expect(document.getElementById('rule-draft-post-enable')?.hidden).toBe(true)
  })

  it('dispatches rescan event from stable notice container', async () => {
    const handler = vi.fn()
    window.addEventListener('diskclean:trigger-rescan', handler)
    await handleRuleDraftEnabled('draft-1')
    document.querySelector<HTMLButtonElement>('#rule-draft-post-enable .btn-primary')?.click()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(isPostEnableNoticeVisible()).toBe(false)
    window.removeEventListener('diskclean:trigger-rescan', handler)
  })

  it('closes notice before rescan when using triggerPostEnableRescan', async () => {
    await handleRuleDraftEnabled('draft-1')
    const handler = vi.fn()
    window.addEventListener('diskclean:trigger-rescan', handler)
    triggerPostEnableRescan()
    expect(isPostEnableNoticeVisible()).toBe(false)
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener('diskclean:trigger-rescan', handler)
  })

  it('dismisses notice when the enabled draft is disabled', async () => {
    await handleRuleDraftEnabled('draft-1')
    vi.mocked(window.diskClean.listRuleDrafts).mockResolvedValue([
      { ...draft, status: 'disabled' }
    ])
    await loadRuleKnowledgeSettings()
    expect(isPostEnableNoticeVisible()).toBe(false)
  })

  it('dismisses notice when the enabled draft is deleted on reload', async () => {
    await handleRuleDraftEnabled('draft-1')
    vi.mocked(window.diskClean.listRuleDrafts).mockResolvedValue([])
    await loadRuleKnowledgeSettings()
    expect(isPostEnableNoticeVisible()).toBe(false)
  })

  it('keeps notice when reload still shows the draft as enabled', async () => {
    await handleRuleDraftEnabled('draft-1')
    vi.mocked(window.diskClean.listRuleDrafts).mockResolvedValue([draft])
    await loadRuleKnowledgeSettings()
    expect(isPostEnableNoticeVisible()).toBe(true)
  })

  it('switches notice to the latest enabled draft', async () => {
    await handleRuleDraftEnabled('draft-1')
    const draft2: StoredRuleDraft = {
      ...draft,
      id: 'draft-2',
      draft: { ...draft.draft, name: 'Second rule' }
    }
    vi.mocked(window.diskClean.listRuleDrafts).mockResolvedValue([draft, draft2])
    await handleRuleDraftEnabled('draft-2')
    expect(isPostEnableNoticeVisible()).toBe(true)
    expect(document.getElementById('rule-drafts-status')?.textContent).toContain(
      '需要重新扫描后才能更新清理结果'
    )
  })

  it('survives another settings reload after enable', async () => {
    await handleRuleDraftEnabled('draft-1')
    await loadRuleKnowledgeSettings()
    expect(isPostEnableNoticeVisible()).toBe(true)
  })
})
