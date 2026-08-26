import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { agentIpcFail, agentIpcOk } from '../../shared/agent-ipc'
import { isTrustedMainWindowSender } from '../window-security'
import { AgentError } from '../agent/agent-errors'
import {
  approveRuleDraft,
  confirmAndEnableRuleDraft,
  disableRuleDraft,
  enableApprovedRuleDraft,
  getActiveScanSessionPublic,
  getSafetyPolicy,
  importRuleDraftFromJson,
  listRulePacks,
  listStoredRuleDrafts,
  previewStoredRuleDraft,
  rejectRuleDraft,
  removeRuleDraft,
  setRulePackEnabled
} from './rule-layer-service'
import {
  runAgentGenerateRuleDraft,
  cancelRuleDraftGeneration
} from './rule-draft-agent-service'
import { getScanSession } from '../scan/scan-session-store'
import { buildRuleWritingPack, assertWritingPackSafe } from './rule-draft-writing-pack'
import { loadUserRulePackState } from './rule-draft-store'
import { RULE_DRAFT_LIMITS } from '../../shared/rule-draft-limits'
import { assertImportJsonSize } from './rule-store-sanitizer'
import type { AgentGenerateRuleDraftRequest } from '../../shared/rule-layer-types'

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedMainWindowSender(event.sender)) {
    throw new AgentError('IPC_UNAUTHORIZED', '未授权的规则请求')
  }
}

function validateGenerateDraftRequest(input: unknown): AgentGenerateRuleDraftRequest {
  if (!input || typeof input !== 'object') throw new AgentError('INVALID_INPUT', '无效请求')
  const payload = input as Record<string, unknown>
  if (typeof payload.sessionId !== 'string' || !payload.sessionId.trim()) {
    throw new AgentError('INVALID_INPUT', '无效的扫描会话')
  }
  if (!Array.isArray(payload.candidateIds) || !payload.candidateIds.every((id) => typeof id === 'string')) {
    throw new AgentError('INVALID_INPUT', '无效的候选项列表')
  }
  return {
    sessionId: payload.sessionId.trim(),
    candidateIds: payload.candidateIds.map((id) => String(id).trim()).filter(Boolean)
  }
}

export function registerRuleLayerIpc(): void {
  ipcMain.handle('rules:safetyPolicy', (event) => {
    try {
      assertTrustedSender(event)
      return agentIpcOk(getSafetyPolicy())
    } catch (error) {
      return agentIpcFail('INTERNAL_ERROR', '读取安全策略失败')
    }
  })

  ipcMain.handle('rules:listPacks', (event) => {
    try {
      assertTrustedSender(event)
      const packs = listRulePacks()
      const state = loadUserRulePackState()
      return agentIpcOk(
        packs.map((pack) => ({
          ...pack,
          enabled: !state.disabledPackIds.includes(pack.id),
          ruleCount: pack.rules.length
        }))
      )
    } catch {
      return agentIpcFail('INTERNAL_ERROR', '读取规则包失败')
    }
  })

  ipcMain.handle('rules:setPackEnabled', (event, packId: unknown, enabled: unknown) => {
    try {
      assertTrustedSender(event)
      if (typeof packId !== 'string' || typeof enabled !== 'boolean') {
        throw new AgentError('INVALID_INPUT', '无效请求')
      }
      setRulePackEnabled(packId, enabled)
      return agentIpcOk(true)
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '更新规则包失败')
    }
  })

  ipcMain.handle('rules:listDrafts', (event) => {
    try {
      assertTrustedSender(event)
      return agentIpcOk(listStoredRuleDrafts())
    } catch {
      return agentIpcFail('INTERNAL_ERROR', '读取规则草稿失败')
    }
  })

  ipcMain.handle('scan:getActiveSession', (event) => {
    try {
      assertTrustedSender(event)
      return agentIpcOk(getActiveScanSessionPublic())
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '读取扫描会话失败')
    }
  })

  ipcMain.handle('rules:previewDraft', async (event, draftId: unknown, sessionId?: unknown) => {
    try {
      assertTrustedSender(event)
      if (typeof draftId !== 'string') {
        throw new AgentError('INVALID_INPUT', '无效请求')
      }
      const preview = await previewStoredRuleDraft(
        draftId,
        typeof sessionId === 'string' ? sessionId : undefined
      )
      if (!preview) throw new AgentError('SESSION_NOT_FOUND', '扫描会话已过期或草稿不存在')
      return agentIpcOk(preview)
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '匹配预览失败')
    }
  })

  ipcMain.handle('rules:confirmEnableDraft', (event, draftId: unknown) => {
    try {
      assertTrustedSender(event)
      if (typeof draftId !== 'string') throw new AgentError('INVALID_INPUT', '无效请求')
      const result = confirmAndEnableRuleDraft(draftId)
      if (!result.ok) return agentIpcFail('DRAFT_APPROVAL_BLOCKED', result.message)
      return agentIpcOk(result)
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '启用规则失败')
    }
  })

  ipcMain.handle('rules:approveDraft', (event, draftId: unknown) => {
    try {
      assertTrustedSender(event)
      if (typeof draftId !== 'string') throw new AgentError('INVALID_INPUT', '无效请求')
      const result = approveRuleDraft(draftId)
      if (!result.ok) return agentIpcFail('DRAFT_APPROVAL_BLOCKED', result.message)
      return agentIpcOk(result)
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '批准草稿失败')
    }
  })

  ipcMain.handle('rules:enableDraft', (event, draftId: unknown) => {
    try {
      assertTrustedSender(event)
      if (typeof draftId !== 'string') throw new AgentError('INVALID_INPUT', '无效请求')
      const result = enableApprovedRuleDraft(draftId)
      if (!result.ok) return agentIpcFail('DRAFT_APPROVAL_BLOCKED', result.message)
      return agentIpcOk(result)
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '启用草稿失败')
    }
  })

  ipcMain.handle('rules:disableDraft', (event, draftId: unknown) => {
    try {
      assertTrustedSender(event)
      if (typeof draftId !== 'string') throw new AgentError('INVALID_INPUT', '无效请求')
      disableRuleDraft(draftId)
      return agentIpcOk(true)
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '禁用草稿失败')
    }
  })

  ipcMain.handle('rules:rejectDraft', (event, draftId: unknown) => {
    try {
      assertTrustedSender(event)
      if (typeof draftId !== 'string') throw new AgentError('INVALID_INPUT', '无效请求')
      rejectRuleDraft(draftId)
      return agentIpcOk(true)
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '拒绝草稿失败')
    }
  })

  ipcMain.handle('rules:deleteDraft', (event, draftId: unknown) => {
    try {
      assertTrustedSender(event)
      if (typeof draftId !== 'string') throw new AgentError('INVALID_INPUT', '无效请求')
      return agentIpcOk(removeRuleDraft(draftId))
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '删除草稿失败')
    }
  })

  ipcMain.handle('rules:importDraft', async (event) => {
    try {
      assertTrustedSender(event)
      const result = await dialog.showOpenDialog({
        title: '导入规则草稿 JSON',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (result.canceled || !result.filePaths[0]) {
        return agentIpcOk({ imported: false, draft: null })
      }
      const raw = readFileSync(result.filePaths[0], 'utf-8')
      assertImportJsonSize(raw, RULE_DRAFT_LIMITS.MAX_DRAFT_JSON_BYTES)
      const parsed = JSON.parse(raw)
      const draft = importRuleDraftFromJson(parsed, raw)
      return agentIpcOk({ imported: true, draft })
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('DRAFT_VALIDATION_FAILED', '导入草稿校验失败')
    }
  })

  ipcMain.handle('rules:exportWritingPack', async (event, input: unknown) => {
    try {
      assertTrustedSender(event)
      if (!input || typeof input !== 'object') throw new AgentError('INVALID_INPUT', '无效请求')
      const payload = input as Record<string, unknown>
      if (typeof payload.sessionId !== 'string') throw new AgentError('INVALID_INPUT', '无效扫描会话')
      const session = getScanSession(payload.sessionId)
      if (!session) throw new AgentError('SESSION_NOT_FOUND', '扫描会话已过期')
      const candidateIds = Array.isArray(payload.candidateIds)
        ? payload.candidateIds.filter((id): id is string => typeof id === 'string')
        : undefined
      const items = [...session.candidates.values()]
      const pack = buildRuleWritingPack(session, items, candidateIds)
      assertWritingPackSafe(pack)

      const saveResult = await dialog.showSaveDialog({
        title: '导出规则编写包',
        defaultPath: 'rule-writing-pack.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (saveResult.canceled || !saveResult.filePath) {
        return agentIpcOk({ exported: false })
      }
      writeFileSync(saveResult.filePath, JSON.stringify(pack, null, 2), 'utf-8')
      return agentIpcOk({ exported: true })
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '导出编写包失败')
    }
  })

  ipcMain.handle('agent:generate-rule-draft', async (event, input: unknown) => {
    try {
      assertTrustedSender(event)
      const request = validateGenerateDraftRequest(input)
      return agentIpcOk(await runAgentGenerateRuleDraft(request))
    } catch (error) {
      if (error instanceof AgentError) return agentIpcFail(error.code, error.message)
      return agentIpcFail('INTERNAL_ERROR', '规则草稿生成失败')
    }
  })

  ipcMain.handle('agent:cancel-rule-draft', (event) => {
    try {
      assertTrustedSender(event)
      cancelRuleDraftGeneration()
      return agentIpcOk(true)
    } catch (error) {
      return agentIpcFail('INTERNAL_ERROR', '取消失败')
    }
  })
}
