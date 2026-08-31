import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import { agentIpcFail, agentIpcOk } from '../../shared/agent-ipc'
import type { CreateUserExperienceInput, UpdateUserExperienceInput } from '../../shared/user-experience-types'
import { USER_EXPERIENCE_LIMITS } from '../../shared/user-experience-limits'
import { isTrustedMainWindowSender } from '../window-security'
import type { AgentErrorCode } from '../../shared/agent-errors'
import {
  createUserExperience,
  deleteUserExperience,
  listUserExperiences,
  updateUserExperience,
  UserExperienceError
} from './user-experience-service'

function mapExperienceErrorCode(code: string): AgentErrorCode {
  switch (code) {
    case 'IPC_UNAUTHORIZED':
    case 'INVALID_INPUT':
    case 'SESSION_NOT_FOUND':
    case 'CANDIDATE_NOT_FOUND':
    case 'CONFIRMATION_REQUIRED':
    case 'LIMIT_REACHED':
      return code === 'IPC_UNAUTHORIZED'
        ? 'IPC_UNAUTHORIZED'
        : code === 'SESSION_NOT_FOUND'
          ? 'SESSION_NOT_FOUND'
          : code === 'CANDIDATE_NOT_FOUND'
            ? 'CANDIDATE_NOT_FOUND'
            : 'INVALID_INPUT'
    default:
      return 'INTERNAL_ERROR'
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedMainWindowSender(event.sender)) {
    throw new UserExperienceError('IPC_UNAUTHORIZED', '未授权的经验请求')
  }
}

function assertBoundedId(value: string, max: number, label: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) {
    throw new UserExperienceError('INVALID_INPUT', `无效的${label}`)
  }
  return trimmed
}

function validateCreateInput(input: unknown): CreateUserExperienceInput {
  if (!input || typeof input !== 'object') throw new UserExperienceError('INVALID_INPUT', '无效请求')
  const payload = input as Record<string, unknown>
  if (typeof payload.sessionId !== 'string' || !payload.sessionId.trim()) {
    throw new UserExperienceError('INVALID_INPUT', '无效的扫描会话')
  }
  if (typeof payload.candidateId !== 'string' || !payload.candidateId.trim()) {
    throw new UserExperienceError('INVALID_INPUT', '无效的候选项')
  }
  if (payload.kind !== 'keep-exclusion' && payload.kind !== 'recognition-hint') {
    throw new UserExperienceError('INVALID_INPUT', '无效的经验类型')
  }
  if (payload.confirmed !== true) {
    throw new UserExperienceError('CONFIRMATION_REQUIRED', '保存经验前需要用户确认')
  }
  return {
    sessionId: assertBoundedId(payload.sessionId, USER_EXPERIENCE_LIMITS.MAX_SESSION_ID_LENGTH, '扫描会话'),
    candidateId: assertBoundedId(payload.candidateId, USER_EXPERIENCE_LIMITS.MAX_CANDIDATE_ID_LENGTH, '候选项'),
    kind: payload.kind,
    confirmed: true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    reason: typeof payload.reason === 'string' ? payload.reason : undefined
  }
}

function validateUpdateInput(input: unknown): UpdateUserExperienceInput {
  if (!input || typeof input !== 'object') throw new UserExperienceError('INVALID_INPUT', '无效请求')
  const payload = input as Record<string, unknown>
  if (typeof payload.id !== 'string' || !payload.id.trim()) {
    throw new UserExperienceError('INVALID_INPUT', '无效的经验条目')
  }
  return {
    id: assertBoundedId(payload.id, USER_EXPERIENCE_LIMITS.MAX_ID_LENGTH, '经验条目'),
    name: typeof payload.name === 'string' ? payload.name : undefined,
    reason: typeof payload.reason === 'string' ? payload.reason : undefined,
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : undefined
  }
}

export function registerUserExperienceIpc(): void {
  ipcMain.handle('experience:list', (event) => {
    try {
      assertTrustedSender(event)
      return agentIpcOk(listUserExperiences())
    } catch (error) {
      if (error instanceof UserExperienceError) {
        return agentIpcFail(mapExperienceErrorCode(error.code), error.message)
      }
      return agentIpcFail('INTERNAL_ERROR', '读取用户经验失败')
    }
  })

  ipcMain.handle('experience:create', (event, input) => {
    try {
      assertTrustedSender(event)
      return agentIpcOk(createUserExperience(validateCreateInput(input)))
    } catch (error) {
      if (error instanceof UserExperienceError) {
        return agentIpcFail(mapExperienceErrorCode(error.code), error.message)
      }
      return agentIpcFail('INTERNAL_ERROR', '保存用户经验失败')
    }
  })

  ipcMain.handle('experience:update', (event, input) => {
    try {
      assertTrustedSender(event)
      const updated = updateUserExperience(validateUpdateInput(input))
      if (!updated) return agentIpcFail('INVALID_INPUT', '经验条目不存在')
      return agentIpcOk(updated)
    } catch (error) {
      if (error instanceof UserExperienceError) {
        return agentIpcFail(mapExperienceErrorCode(error.code), error.message)
      }
      return agentIpcFail('INTERNAL_ERROR', '更新用户经验失败')
    }
  })

  ipcMain.handle('experience:delete', (event, id: unknown) => {
    try {
      assertTrustedSender(event)
      if (typeof id !== 'string' || !id.trim()) {
        return agentIpcFail('INVALID_INPUT', '无效的经验条目')
      }
      const deleted = deleteUserExperience(
        assertBoundedId(id, USER_EXPERIENCE_LIMITS.MAX_ID_LENGTH, '经验条目')
      )
      if (!deleted) return agentIpcFail('INVALID_INPUT', '经验条目不存在')
      return agentIpcOk(true)
    } catch (error) {
      if (error instanceof UserExperienceError) {
        return agentIpcFail(mapExperienceErrorCode(error.code), error.message)
      }
      return agentIpcFail('INTERNAL_ERROR', '删除用户经验失败')
    }
  })
}
