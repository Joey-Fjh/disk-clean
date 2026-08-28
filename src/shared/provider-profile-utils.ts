import type { ProviderProfilesPublicState, ProviderProfilePublic } from '../shared/provider-types'

export function getActiveProfile(
  state: ProviderProfilesPublicState | null
): ProviderProfilePublic | null {
  if (!state?.activeProfileId) return null
  return state.profiles.find((profile) => profile.id === state.activeProfileId) ?? null
}

export function activeProfileHasKey(state: ProviderProfilesPublicState | null): boolean {
  return Boolean(getActiveProfile(state)?.hasKey)
}
