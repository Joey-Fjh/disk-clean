import type { ProviderConfigPublic, ProviderId } from '../shared/provider-types'

export interface ProviderFormValues {
  providerId: ProviderId
  baseUrl: string
  model: string
  apiKey: string
}

/** 用主进程返回的已保存配置生成表单值（API Key 输入框留空）。 */
export function providerFormValuesFromSaved(config: ProviderConfigPublic): ProviderFormValues {
  return {
    providerId: config.providerId,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: ''
  }
}

export function isProviderFormDirty(
  form: ProviderFormValues,
  saved: ProviderConfigPublic | null
): boolean {
  if (form.apiKey.trim()) return true
  if (!saved) {
    return Boolean(form.baseUrl.trim() || form.model.trim() || form.providerId !== 'openai')
  }
  return (
    form.providerId !== saved.providerId ||
    form.baseUrl.trim() !== saved.baseUrl ||
    form.model.trim() !== saved.model
  )
}

export function canRunProviderTests(
  form: ProviderFormValues,
  saved: ProviderConfigPublic | null,
  testing: boolean
): boolean {
  if (testing) return false
  if (!saved?.hasKey) return false
  return !isProviderFormDirty(form, saved)
}

/** 保存后表单应与主进程规范化配置同步，测试按钮可立即启用。 */
export function canRunProviderTestsAfterSave(saved: ProviderConfigPublic): boolean {
  return canRunProviderTests(providerFormValuesFromSaved(saved), saved, false)
}
