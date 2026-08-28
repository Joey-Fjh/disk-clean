import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import type {
  CreateProviderProfileInput,
  ProviderId,
  UpdateProviderProfileInput
} from '../../shared/provider-types'
import { PROVIDER_INPUT_LIMITS } from '../../shared/provider-limits'
import { providerIpcFail, providerIpcOk } from '../../shared/provider-ipc'
import { isTrustedMainWindowSender } from '../window-security'
import { ProviderError } from './provider-errors'
import {
  createProviderProfile,
  deleteProviderProfile,
  listProviderProfiles,
  setActiveProviderProfile,
  testProviderCapability,
  testProviderConnection,
  updateProviderProfile
} from './provider-service'

function assertTrustedProviderSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedMainWindowSender(event.sender)) {
    throw new ProviderError('IPC_UNAUTHORIZED', '未授权的 Provider 请求')
  }
}

function validateProfileIdInput(profileId: unknown): string {
  if (typeof profileId !== 'string' || !profileId.trim()) {
    throw new ProviderError('INVALID_INPUT', '配置 ID 无效')
  }
  if (profileId.length > PROVIDER_INPUT_LIMITS.PROFILE_ID_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', '配置 ID 无效')
  }
  return profileId.trim()
}

function validateProviderFields(payload: Record<string, unknown>): {
  providerId: ProviderId
  baseUrl: string
  model: string
  apiKey?: string
} {
  const providerId = payload.providerId
  const baseUrl = payload.baseUrl
  const model = payload.model
  const apiKey = payload.apiKey

  if (providerId !== 'openai' && providerId !== 'deepseek' && providerId !== 'custom') {
    throw new ProviderError('INVALID_INPUT', '未知的 Provider')
  }
  if (typeof baseUrl !== 'string') {
    throw new ProviderError('INVALID_INPUT', 'Base URL 无效')
  }
  if (baseUrl.length > PROVIDER_INPUT_LIMITS.BASE_URL_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', 'Base URL 过长')
  }
  if (typeof model !== 'string') {
    throw new ProviderError('INVALID_INPUT', '模型名称无效')
  }
  if (model.length > PROVIDER_INPUT_LIMITS.MODEL_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', '模型名称无效')
  }
  if (apiKey !== undefined && typeof apiKey !== 'string') {
    throw new ProviderError('INVALID_INPUT', 'API Key 无效')
  }
  if (typeof apiKey === 'string' && apiKey.length > PROVIDER_INPUT_LIMITS.API_KEY_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', 'API Key 无效')
  }

  return {
    providerId,
    baseUrl,
    model,
    apiKey: typeof apiKey === 'string' ? apiKey : undefined
  }
}

function validateCreateInput(input: unknown): CreateProviderProfileInput {
  if (!input || typeof input !== 'object') {
    throw new ProviderError('INVALID_INPUT', '配置无效')
  }
  const payload = input as Record<string, unknown>
  const name = payload.name
  if (typeof name !== 'string') {
    throw new ProviderError('INVALID_INPUT', '配置名称无效')
  }
  if (name.trim().length === 0 || name.length > PROVIDER_INPUT_LIMITS.PROFILE_NAME_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', '配置名称无效')
  }
  const fields = validateProviderFields(payload)
  return { name, ...fields }
}

function validateUpdateInput(input: unknown): UpdateProviderProfileInput {
  if (!input || typeof input !== 'object') {
    throw new ProviderError('INVALID_INPUT', '配置无效')
  }
  const payload = input as Record<string, unknown>
  const profileId = validateProfileIdInput(payload.profileId)
  const name = payload.name
  if (typeof name !== 'string') {
    throw new ProviderError('INVALID_INPUT', '配置名称无效')
  }
  if (name.trim().length === 0 || name.length > PROVIDER_INPUT_LIMITS.PROFILE_NAME_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', '配置名称无效')
  }
  const fields = validateProviderFields(payload)
  return { profileId, name, ...fields }
}

function validateProfileIdPayload(input: unknown): string {
  if (!input || typeof input !== 'object') {
    throw new ProviderError('INVALID_INPUT', '配置 ID 无效')
  }
  return validateProfileIdInput((input as Record<string, unknown>).profileId)
}

export function handleProviderListProfiles(event: IpcMainInvokeEvent) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(listProviderProfiles())
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export function handleProviderCreateProfile(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(createProviderProfile(validateCreateInput(input)))
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export function handleProviderUpdateProfile(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(updateProviderProfile(validateUpdateInput(input)))
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export function handleProviderDeleteProfile(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(deleteProviderProfile(validateProfileIdPayload(input)))
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export function handleProviderSetActiveProfile(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(setActiveProviderProfile(validateProfileIdPayload(input)))
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export async function handleProviderTestConnection(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(await testProviderConnection(validateProfileIdPayload(input)))
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export async function handleProviderTestCapability(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(await testProviderCapability(validateProfileIdPayload(input)))
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export function registerProviderIpc(): void {
  ipcMain.handle('provider:listProfiles', (event) => handleProviderListProfiles(event))
  ipcMain.handle('provider:createProfile', (event, input: unknown) =>
    handleProviderCreateProfile(event, input)
  )
  ipcMain.handle('provider:updateProfile', (event, input: unknown) =>
    handleProviderUpdateProfile(event, input)
  )
  ipcMain.handle('provider:deleteProfile', (event, input: unknown) =>
    handleProviderDeleteProfile(event, input)
  )
  ipcMain.handle('provider:setActiveProfile', (event, input: unknown) =>
    handleProviderSetActiveProfile(event, input)
  )
  ipcMain.handle('provider:testConnection', (event, input: unknown) =>
    handleProviderTestConnection(event, input)
  )
  ipcMain.handle('provider:testCapability', (event, input: unknown) =>
    handleProviderTestCapability(event, input)
  )
}
