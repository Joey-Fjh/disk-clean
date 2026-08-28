export interface ProfileTestStatus {
  message: string
  tone: 'neutral' | 'success' | 'error'
}

export class ProviderTestState {
  private readonly testingProfileIds = new Set<string>()
  private readonly lastTestStatus = new Map<string, ProfileTestStatus>()
  private readonly testGenerations = new Map<string, number>()

  isTesting(profileId: string): boolean {
    return this.testingProfileIds.has(profileId)
  }

  getTestingProfileIds(): ReadonlySet<string> {
    return this.testingProfileIds
  }

  getLastTestStatus(profileId: string): ProfileTestStatus | undefined {
    return this.lastTestStatus.get(profileId)
  }

  getLastTestStatusMap(): ReadonlyMap<string, ProfileTestStatus> {
    return this.lastTestStatus
  }

  beginTest(profileId: string, message: string): number {
    const generation = (this.testGenerations.get(profileId) ?? 0) + 1
    this.testGenerations.set(profileId, generation)
    this.testingProfileIds.add(profileId)
    this.lastTestStatus.set(profileId, { message, tone: 'neutral' })
    return generation
  }

  completeTest(profileId: string, generation: number, status: ProfileTestStatus): boolean {
    if (this.testGenerations.get(profileId) !== generation) {
      return false
    }
    this.testingProfileIds.delete(profileId)
    this.lastTestStatus.set(profileId, status)
    return true
  }

  invalidateProfile(profileId: string): void {
    this.testingProfileIds.delete(profileId)
    this.lastTestStatus.delete(profileId)
    this.testGenerations.set(profileId, (this.testGenerations.get(profileId) ?? 0) + 1)
  }
}
