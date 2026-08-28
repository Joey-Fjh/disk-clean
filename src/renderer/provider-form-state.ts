import { PROVIDER_PRESETS } from '../shared/provider-types'
import type { ProviderId, ProviderProfilePublic } from '../shared/provider-types'

export interface ProviderFormValues {
  name: string
  providerId: ProviderId
  baseUrl: string
  model: string
  apiKey: string
}

function safeOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl.trim()).origin
  } catch {
    return null
  }
}

export function providerFormValuesFromSaved(profile: ProviderProfilePublic): ProviderFormValues {
  return {
    name: profile.name,
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: ''
  }
}

export function isProviderFormDirty(
  form: ProviderFormValues,
  saved: ProviderProfilePublic | null
): boolean {
  if (form.apiKey.trim()) return true
  if (!saved) {
    return Boolean(
      form.name.trim() ||
        form.baseUrl.trim() ||
        form.model.trim() ||
        form.providerId !== 'openai'
    )
  }
  return (
    form.name.trim() !== saved.name ||
    form.providerId !== saved.providerId ||
    form.baseUrl.trim() !== saved.baseUrl ||
    form.model.trim() !== saved.model
  )
}

export function requiresKeyReentry(form: ProviderFormValues, saved: ProviderProfilePublic | null): boolean {
  if (!saved?.hasKey) return false
  if (form.apiKey.trim()) return false
  const nextOrigin = safeOrigin(form.baseUrl)
  const savedOrigin = safeOrigin(saved.baseUrl)
  if (!nextOrigin || !savedOrigin) return true
  return nextOrigin !== savedOrigin
}

export function canRunProviderTests(
  form: ProviderFormValues,
  saved: ProviderProfilePublic | null,
  testing: boolean
): boolean {
  if (testing) return false
  if (!saved?.hasKey) return false
  if (isProviderFormDirty(form, saved)) return false
  if (requiresKeyReentry(form, saved)) return false
  return true
}

export function canRunProviderTestsAfterSave(saved: ProviderProfilePublic): boolean {
  return canRunProviderTests(providerFormValuesFromSaved(saved), saved, false)
}

export function presetLabel(providerId: ProviderId): string {
  return PROVIDER_PRESETS.find((p) => p.id === providerId)?.label ?? providerId
}

export function formatProfileOrigin(baseUrl: string): string {
  return safeOrigin(baseUrl) ?? baseUrl
}
