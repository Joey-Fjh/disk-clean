import type { ProviderConfigPublic, ProviderErrorCode, ProviderTestResult } from './provider-types'

export type ProviderIpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ProviderErrorCode; message: string }

export function providerIpcOk<T>(value: T): ProviderIpcResult<T> {
  return { ok: true, value }
}

export function providerIpcFail<T>(
  code: ProviderErrorCode,
  message: string
): ProviderIpcResult<T> {
  return { ok: false, code, message }
}

export type ProviderGetConfigIpcResult = ProviderIpcResult<ProviderConfigPublic | null>
export type ProviderSaveConfigIpcResult = ProviderIpcResult<ProviderConfigPublic>
export type ProviderDeleteKeyIpcResult = ProviderIpcResult<ProviderConfigPublic | null>
export type ProviderTestIpcResult = ProviderIpcResult<ProviderTestResult>
