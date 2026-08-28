import type { Category, ContentType, RuleConfig } from './types'
import type { PathAccessPolicy } from './path-access-policy'

export const RULE_PACK_SCHEMA_VERSION = '1' as const
export const RULE_DRAFT_SCHEMA_VERSION = '1' as const

export type RulePackOrigin = 'official' | 'user-import' | 'agent-generated' | 'legacy-user'

export type RuleDraftOrigin = 'agent-generated' | 'user-import' | 'legacy-user'

export type RuleDraftStatus =
  | 'draft'
  | 'validated'
  | 'previewed'
  | 'approved'
  | 'enabled'
  | 'disabled'
  | 'rejected'
  | 'retired'

export type SuggestedRisk = Category

export interface RulePackManifest {
  schemaVersion: typeof RULE_PACK_SCHEMA_VERSION
  id: string
  name: string
  version: string
  origin: RulePackOrigin
  platform: 'windows'
  description?: string
  rules: RuleConfig[]
}

export interface DetectionHeuristic {
  id: string
  name: string
  contentType?: ContentType
  patterns?: string[]
  subdirs?: string[]
  globDirs?: string[]
  maxDepth?: number
  maxAgeDays?: number
  reason?: string
  impact?: string
  rebuildable?: boolean
  userDataRisk?: boolean
}

export interface CoreSafetyPolicy {
  protectedPaths: string[]
  protectedLabels: Record<string, string>
  constraints: string[]
  pathAccessPolicy: PathAccessPolicy
}

export interface RuleDraftV1 {
  schemaVersion: typeof RULE_DRAFT_SCHEMA_VERSION
  name: string
  contentType: ContentType
  basePlaceholders: string[]
  relativePatterns?: string[]
  subdirs?: string[]
  globDirs?: string[]
  maxDepth?: number
  maxAgeDays?: number
  reason: string
  impact?: string
  rebuildable?: boolean
  requiresAppClosed?: boolean
  suggestedRisk: SuggestedRisk
  source: RuleDraftOrigin
  generatedFromSessionId?: string
  generatedFromCandidateIds?: string[]
  createdAt: string
}

export interface RuleDraftPreviewSample {
  candidateId: string
  pathSummary: string
  size: number
}

export interface RuleDraftPreviewResult {
  sessionId: string
  sessionFingerprint: string
  matchCount: number
  ruleTargetCount: number
  estimatedBytes: number
  excludedProtectedCount: number
  protectedTargetCount: number
  drives: string[]
  samples: RuleDraftPreviewSample[]
  warnings: string[]
  approvable: boolean
  blockReason?: string
  scope: {
    basePlaceholders: string[]
    subdirs?: string[]
    globDirs?: string[]
    relativePatterns?: string[]
    suggestedRisk: string
    reason: string
    impact?: string
    rebuildable?: boolean
  }
  previewedAt: string
}

export interface StoredRuleDraft {
  id: string
  draft: RuleDraftV1
  status: RuleDraftStatus
  origin: RuleDraftOrigin
  sessionId?: string
  sessionFingerprint?: string
  candidateIds?: string[]
  preview?: RuleDraftPreviewResult
  compiledRuleId?: string
  approvedAt?: string
  createdAt: string
  updatedAt: string
}

export interface UserRulePackState {
  schemaVersion: typeof RULE_PACK_SCHEMA_VERSION
  disabledPackIds: string[]
  packs: RulePackManifest[]
}

export interface RuleDraftStoreState {
  schemaVersion: typeof RULE_DRAFT_SCHEMA_VERSION
  drafts: StoredRuleDraft[]
  migrationCompleted?: boolean
}

export interface AgentGenerateRuleDraftRequest {
  sessionId: string
  candidateIds: string[]
}

export interface AgentGenerateRuleDraftResult {
  draftId: string
  draft: RuleDraftV1
  status: RuleDraftStatus
}

export interface RuleWritingPackCandidate {
  candidateRef: string
  contentType: string
  hierarchySummary?: string
  logicalSize: number
  discoverySources: string[]
  localFeatures: string[]
  evidence: string[]
}

export interface RuleWritingPack {
  schemaVersion: '1'
  generatedAt: string
  sessionId: string
  sessionFingerprint: string
  ruleDraftSchemaVersion: typeof RULE_DRAFT_SCHEMA_VERSION
  forbiddenFields: string[]
  safetyConstraints: string[]
  privacyNotes: string[]
  candidates: RuleWritingPackCandidate[]
}
