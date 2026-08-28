import type {
  CoreSafetyPolicy,
  RuleDraftPreviewResult,
  RulePackManifest,
  StoredRuleDraft
} from '../../shared/rule-layer-types'
import type { RuleConfig, RuleWithMeta } from '../../shared/types'
import { isRuleActiveForScan } from '../../shared/rule-enforcement'
import {
  loadCoreSafetyPolicy,
  loadDetectionHeuristics,
  loadOfficialRulePacks
} from './rule-layer-loader'
import { compileRuleDraftToRuleConfig } from './rule-draft-compiler'
import {
  deleteRuleDraft,
  getRuleDraft,
  importRuleDraftJson,
  listRuleDrafts,
  loadUserRulePackState,
  saveUserRulePackState,
  updateRuleDraftStatus,
  createRuleDraftRecord,
  saveRuleDraftRecord
} from './rule-draft-store'
import {
  canApproveRuleDraftPreview,
  previewRuleDraftOnSession,
  sessionFingerprint
} from './rule-draft-preview'
import { migrateLegacyUserRulesIfNeeded } from './rule-legacy-migration'
import { getActiveScanSessionInfo, getScanSession } from '../scan/scan-session-store'
import { RuleDraftValidationError, validateRuleDraftInput } from './rule-draft-validator'

let migrationDone = false

function ensureMigration(): void {
  if (migrationDone) return
  migrateLegacyUserRulesIfNeeded()
  migrationDone = true
}

export function getSafetyPolicy(): CoreSafetyPolicy {
  return loadCoreSafetyPolicy()
}

export function getActiveScanSessionPublic() {
  return getActiveScanSessionInfo()
}

export function listRulePacks(): RulePackManifest[] {
  ensureMigration()
  return [...loadOfficialRulePacks(), ...loadUserRulePackState().packs]
}

export function listEnabledRulePacks(): RulePackManifest[] {
  const state = loadUserRulePackState()
  const disabled = new Set(state.disabledPackIds)
  return listRulePacks().filter((pack) => !disabled.has(pack.id))
}

export function setRulePackEnabled(packId: string, enabled: boolean): RulePackManifest[] {
  const state = loadUserRulePackState()
  if (enabled) {
    state.disabledPackIds = state.disabledPackIds.filter((id) => id !== packId)
  } else if (!state.disabledPackIds.includes(packId)) {
    state.disabledPackIds.push(packId)
  }
  saveUserRulePackState(state)
  return listRulePacks()
}

export function getEnabledDraftRules(): RuleConfig[] {
  const rules: RuleConfig[] = []
  for (const draft of listRuleDrafts()) {
    if (draft.status !== 'enabled') continue
    try {
      rules.push(compileRuleDraftToRuleConfig(draft.draft, draft.id))
    } catch {
      // skip invalid compiled drafts
    }
  }
  return rules
}

export function getLayeredActiveRules(): RuleConfig[] {
  ensureMigration()
  const packRules = listEnabledRulePacks().flatMap((pack) => pack.rules)
  const draftRules = getEnabledDraftRules()
  const byId = new Map<string, RuleConfig>()
  for (const rule of packRules) {
    if (!isRuleActiveForScan(rule)) continue
    byId.set(rule.id, rule)
  }
  for (const rule of draftRules) byId.set(rule.id, rule)
  return [...byId.values()]
}

export function getLayeredRulesWithMeta(): RuleWithMeta[] {
  ensureMigration()
  const state = loadUserRulePackState()
  const disabledPacks = new Set(state.disabledPackIds)
  const items: RuleWithMeta[] = []

  for (const pack of listRulePacks()) {
    const packEnabled = !disabledPacks.has(pack.id)
    for (const rule of pack.rules) {
      items.push({
        ...rule,
        enabled: packEnabled,
        source: pack.origin === 'legacy-user' || pack.origin === 'user-import' ? 'custom' : 'builtin'
      })
    }
  }

  for (const draft of listRuleDrafts()) {
    if (!['approved', 'enabled', 'disabled'].includes(draft.status)) continue
    try {
      const rule = compileRuleDraftToRuleConfig(draft.draft, draft.id)
      items.push({
        ...rule,
        enabled: draft.status === 'enabled',
        source: 'custom'
      })
    } catch {
      // skip
    }
  }

  return items
}

export function getDetectionHeuristicsList() {
  return loadDetectionHeuristics()
}

export function listStoredRuleDrafts(): StoredRuleDraft[] {
  return listRuleDrafts()
}

export async function previewStoredRuleDraft(
  draftId: string,
  sessionId?: string
): Promise<RuleDraftPreviewResult | null> {
  const draft = getRuleDraft(draftId)
  if (!draft) return null

  const active = getActiveScanSessionInfo()
  const targetSessionId = sessionId ?? active?.sessionId
  if (!targetSessionId) return null

  const session = getScanSession(targetSessionId)
  if (!session) return null

  const preview = await previewRuleDraftOnSession(draft.draft, session, draft.id)
  updateRuleDraftStatus(draftId, 'previewed', {
    preview,
    sessionId: session.sessionId,
    sessionFingerprint: preview.sessionFingerprint
  })
  return preview
}

export function approveRuleDraft(draftId: string): { ok: boolean; message: string; draft?: StoredRuleDraft } {
  const draft = getRuleDraft(draftId)
  if (!draft) return { ok: false, message: '草稿不存在' }
  if (!draft.preview) return { ok: false, message: '请先完成匹配预览' }
  if (!draft.sessionId) return { ok: false, message: '草稿未绑定扫描会话' }

  const session = getScanSession(draft.sessionId)
  const approval = canApproveRuleDraftPreview(draft.preview, session)
  if (!approval.ok) return { ok: false, message: approval.reason ?? '无法批准' }

  try {
    compileRuleDraftToRuleConfig(draft.draft, draft.id)
  } catch (error) {
    const message = error instanceof RuleDraftValidationError ? error.message : '草稿编译失败'
    return { ok: false, message }
  }

  const updated = updateRuleDraftStatus(draftId, 'approved', {
    compiledRuleId: `draft:${draftId}`,
    sessionFingerprint: session ? sessionFingerprint(session) : draft.sessionFingerprint
  })
  return {
    ok: true,
    message: '规则已保存。请在设置中启用，并重新扫描以应用。',
    draft: updated ?? undefined
  }
}

export function enableApprovedRuleDraft(draftId: string): { ok: boolean; message: string; code?: string } {
  const draft = getRuleDraft(draftId)
  if (!draft || (draft.status !== 'approved' && draft.status !== 'disabled')) {
    return { ok: false, message: '仅已批准或已禁用的草稿可启用' }
  }
  if (!draft.preview || draft.preview.matchCount === 0) {
    return { ok: false, message: '零匹配草稿不能启用' }
  }
  if (!draft.sessionId || !getScanSession(draft.sessionId)) {
    return { ok: false, message: '绑定扫描已失效，请重新扫描并预览' }
  }
  const approval = canApproveRuleDraftPreview(draft.preview, getScanSession(draft.sessionId))
  if (!approval.ok) return { ok: false, message: approval.reason ?? '预览已失效' }

  updateRuleDraftStatus(draftId, 'enabled')
  return { ok: true, message: '规则已启用，需要重新扫描后才能更新清理结果。', code: 'ENABLED_NEEDS_RESCAN' }
}

export function confirmAndEnableRuleDraft(draftId: string): {
  ok: boolean
  message: string
  code?: string
  draft?: StoredRuleDraft
} {
  const draft = getRuleDraft(draftId)
  if (!draft) return { ok: false, message: '草稿不存在', code: 'DRAFT_NOT_FOUND' }
  if (!draft.preview) return { ok: false, message: '请先完成匹配预览', code: 'PREVIEW_REQUIRED' }
  if (!draft.preview.approvable) {
    return {
      ok: false,
      message: draft.preview.blockReason ?? '当前预览不可启用',
      code: 'PREVIEW_NOT_APPROVABLE'
    }
  }
  if (!draft.sessionId) {
    return { ok: false, message: '草稿未绑定扫描会话', code: 'SESSION_REQUIRED' }
  }

  const session = getScanSession(draft.sessionId)
  const approval = canApproveRuleDraftPreview(draft.preview, session)
  if (!approval.ok) {
    return { ok: false, message: approval.reason ?? '预览已失效', code: 'STALE_PREVIEW' }
  }

  try {
    compileRuleDraftToRuleConfig(draft.draft, draft.id)
  } catch (error) {
    const message = error instanceof RuleDraftValidationError ? error.message : '草稿编译失败'
    return { ok: false, message, code: 'COMPILE_FAILED' }
  }

  const enabled = updateRuleDraftStatus(draftId, 'enabled', {
    compiledRuleId: `draft:${draftId}`,
    sessionFingerprint: session ? sessionFingerprint(session) : draft.sessionFingerprint,
    approvedAt: new Date().toISOString()
  })
  if (!enabled) {
    return { ok: false, message: '启用失败', code: 'ENABLE_FAILED' }
  }

  return {
    ok: true,
    message: '规则已启用，需要重新扫描后才能更新清理结果。',
    code: 'ENABLED_NEEDS_RESCAN',
    draft: enabled
  }
}

export function disableRuleDraft(draftId: string): void {
  const draft = getRuleDraft(draftId)
  if (!draft) return
  if (draft.status === 'enabled') updateRuleDraftStatus(draftId, 'disabled')
}

export function rejectRuleDraft(draftId: string): void {
  updateRuleDraftStatus(draftId, 'rejected')
}

export function removeRuleDraft(draftId: string): boolean {
  return deleteRuleDraft(draftId)
}

export function importRuleDraftFromJson(input: unknown, rawJson?: string): StoredRuleDraft {
  return importRuleDraftJson(input, 'user-import', rawJson)
}

export function updateRuleDraftContent(
  draftId: string,
  patch: Record<string, unknown>
): StoredRuleDraft {
  const record = getRuleDraft(draftId)
  if (!record) throw new RuleDraftValidationError('草稿不存在')
  if (record.status === 'enabled') {
    throw new RuleDraftValidationError('已启用规则须先停用再编辑')
  }
  const draft = validateRuleDraftInput({ ...record.draft, ...patch })
  return saveRuleDraftRecord({
    ...record,
    draft,
    status: 'validated',
    preview: undefined,
    sessionFingerprint: undefined,
    sessionId: undefined,
    updatedAt: new Date().toISOString()
  })
}

export function copyBuiltInRuleAsDraft(rule: RuleConfig): StoredRuleDraft {
  return createRuleDraftRecord(
    {
      schemaVersion: '1',
      name: `${rule.name}（副本）`,
      contentType: rule.contentType ?? 'app-cache',
      basePlaceholders: rule.paths,
      relativePatterns: rule.patterns,
      subdirs: rule.subdirs,
      globDirs: rule.globDirs,
      maxDepth: rule.maxDepth,
      maxAgeDays: rule.maxAgeDays,
      reason: rule.reason ?? rule.description ?? rule.name,
      impact: rule.impact,
      rebuildable: rule.rebuildable,
      requiresAppClosed: rule.requiresAppClosed,
      suggestedRisk: rule.category,
      source: 'user-import',
      createdAt: new Date().toISOString()
    },
    'user-import',
    { status: 'validated' }
  )
}

export function resetRuleLayerUserState(): void {
  saveUserRulePackState({
    schemaVersion: '1',
    disabledPackIds: [],
    packs: []
  })
  for (const draft of listRuleDrafts()) {
    deleteRuleDraft(draft.id)
  }
}
