import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import type { SaveProviderConfigInput } from '../../shared/provider-types'
import { PROVIDER_INPUT_LIMITS } from '../../shared/provider-limits'
import { providerIpcFail, providerIpcOk } from '../../shared/provider-ipc'
import { isTrustedMainWindowSender } from '../window-security'
import { ProviderError } from './provider-errors'
import {
  deleteProviderApiKey,
  getProviderConfig,
  saveProviderConfig,
  testProviderCapability,
  testProviderConnection
} from './provider-service'

function assertTrustedProviderSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedMainWindowSender(event.sender)) {
    throw new ProviderError('IPC_UNAUTHORIZED', '未授权的 Provider 请求')
  }
}

function validateSaveInput(input: unknown): SaveProviderConfigInput {
  if (!input || typeof input !== 'object') {
    throw new ProviderError('INVALID_INPUT', '配置无效')
  }
  const payload = input as Record<string, unknown>
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

export function handleProviderGetConfig(event: IpcMainInvokeEvent) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(getProviderConfig())
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export function handleProviderSaveConfig(event: IpcMainInvokeEvent, input: unknown) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(saveProviderConfig(validateSaveInput(input)))
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export function handleProviderDeleteApiKey(event: IpcMainInvokeEvent) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(deleteProviderApiKey())
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export async function handleProviderTestConnection(event: IpcMainInvokeEvent) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(await testProviderConnection())
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export async function handleProviderTestCapability(event: IpcMainInvokeEvent) {
  try {
    assertTrustedProviderSender(event)
    return providerIpcOk(await testProviderCapability())
  } catch (error) {
    if (error instanceof ProviderError) {
      return providerIpcFail(error.code, error.message)
    }
    return providerIpcFail('INVALID_INPUT', '操作失败')
  }
}

export function registerProviderIpc(): void {
  ipcMain.handle('provider:getConfig', (event) => handleProviderGetConfig(event))
  ipcMain.handle('provider:saveConfig', (event, input: unknown) => handleProviderSaveConfig(event, input))
  ipcMain.handle('provider:deleteApiKey', (event) => handleProviderDeleteApiKey(event))
  ipcMain.handle('provider:testConnection', (event) => handleProviderTestConnection(event))
  ipcMain.handle('provider:testCapability', (event) => handleProviderTestCapability(event))
}
