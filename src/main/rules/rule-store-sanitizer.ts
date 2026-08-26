import type {
  RuleDraftPreviewResult,
  RuleDraftStoreState,
  RulePackManifest,
  StoredRuleDraft,
  UserRulePackState
} from '../../shared/rule-layer-types'
import { RULE_DRAFT_SCHEMA_VERSION, RULE_PACK_SCHEMA_VERSION } from '../../shared/rule-layer-types'
import type { RuleConfig } from '../../shared/types'
import { validateRuleInput } from './rule-validator'
import { validateRuleDraftInput, RuleDraftValidationError } from './rule-draft-validator'
import { compileRuleDraftToRuleConfig } from './rule-draft-compiler'
import { loadOfficialRulePacks } from './rule-layer-loader'

const VALID_DRAFT_STATUSES = new Set<StoredRuleDraft['status']>([
  'draft',
  'validated',
  'previewed',
  'approved',
  'enabled',
  'disabled',
  'rejected',
  'retired'
])

const VALID_ORIGINS = new Set<StoredRuleDraft['origin']>([
  'agent-generated',
  'user-import',
  'legacy-user'
])

export interface SanitizedDraftStore {
  state: RuleDraftStoreState
  isolated: unknown[]
  changed: boolean
}

export interface SanitizedPackStore {
  state: UserRulePackState
  isolatedPacks: unknown[]
  changed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value)
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length === value.length ? items : undefined
}

function sanitizePreviewSamples(value: unknown): RuleDraftPreviewResult['samples'] | undefined {
  if (!Array.isArray(value)) return undefined
  const samples: RuleDraftPreviewResult['samples'] = []
  for (const entry of value) {
    if (!isRecord(entry)) return undefined
    if (typeof entry.candidateId !== 'string' || typeof entry.pathSummary !== 'string') return undefined
    if (!isNonNegativeInt(entry.size)) return undefined
    samples.push({
      candidateId: entry.candidateId,
      pathSummary: entry.pathSummary,
      size: entry.size
    })
  }
  return samples
}

function sanitizePreviewScope(value: unknown): RuleDraftPreviewResult['scope'] | undefined {
  if (!isRecord(value)) return undefined
  const basePlaceholders = sanitizeStringArray(value.basePlaceholders)
  if (!basePlaceholders || basePlaceholders.length === 0) return undefined
  if (typeof value.suggestedRisk !== 'string' || typeof value.reason !== 'string') return undefined

  return {
    basePlaceholders,
    subdirs: sanitizeStringArray(value.subdirs),
    globDirs: sanitizeStringArray(value.globDirs),
    relativePatterns: sanitizeStringArray(value.relativePatterns),
    suggestedRisk: value.suggestedRisk,
    reason: value.reason,
    impact: typeof value.impact === 'string' ? value.impact : undefined,
    rebuildable: value.rebuildable === true ? true : value.rebuildable === false ? false : undefined
  }
}

function sanitizePreview(value: unknown): RuleDraftPreviewResult | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.sessionId !== 'string' || typeof value.sessionFingerprint !== 'string') return undefined
  if (!isNonNegativeInt(value.matchCount) || !isNonNegativeInt(value.estimatedBytes)) return undefined
  if (!isNonNegativeInt(value.excludedProtectedCount)) return undefined
  if (!isNonNegativeInt(value.ruleTargetCount)) return undefined
  if (!isNonNegativeInt(value.protectedTargetCount)) return undefined
  if (typeof value.approvable !== 'boolean') return undefined
  if (typeof value.previewedAt !== 'string') return undefined

  const drives = sanitizeStringArray(value.drives)
  const warnings = sanitizeStringArray(value.warnings)
  const samples = sanitizePreviewSamples(value.samples)
  const scope = sanitizePreviewScope(value.scope)
  if (!drives || !warnings || !samples || !scope) return undefined

  return {
    sessionId: value.sessionId,
    sessionFingerprint: value.sessionFingerprint,
    matchCount: value.matchCount,
    ruleTargetCount: value.ruleTargetCount,
    estimatedBytes: value.estimatedBytes,
    excludedProtectedCount: value.excludedProtectedCount,
    protectedTargetCount: value.protectedTargetCount,
    drives,
    samples,
    warnings,
    approvable: value.approvable,
    blockReason: typeof value.blockReason === 'string' ? value.blockReason : undefined,
    scope,
    previewedAt: value.previewedAt
  }
}

export function sanitizeStoredRuleDraft(raw: unknown): StoredRuleDraft | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  if (!VALID_ORIGINS.has(raw.origin as StoredRuleDraft['origin'])) return null
  if (!VALID_DRAFT_STATUSES.has(raw.status as StoredRuleDraft['status'])) return null

  try {
    const draft = validateRuleDraftInput(raw.draft)
    compileRuleDraftToRuleConfig(draft, raw.id)
  } catch {
    return null
  }

  const status = raw.status as StoredRuleDraft['status']
  const preview = sanitizePreview(raw.preview)

  if (status === 'enabled' && (!preview || !preview.approvable || preview.matchCount === 0)) {
    return null
  }

  if ((status === 'previewed' || status === 'approved' || status === 'enabled') && !preview) {
    return null
  }

  if ((status === 'approved' || status === 'enabled') && preview && !preview.approvable) {
    return null
  }

  return {
    id: raw.id.trim(),
    draft: validateRuleDraftInput(raw.draft),
    status,
    origin: raw.origin as StoredRuleDraft['origin'],
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : undefined,
    sessionFingerprint:
      typeof raw.sessionFingerprint === 'string' ? raw.sessionFingerprint : undefined,
    candidateIds: Array.isArray(raw.candidateIds)
      ? raw.candidateIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    preview,
    compiledRuleId: typeof raw.compiledRuleId === 'string' ? raw.compiledRuleId : undefined,
    approvedAt: typeof raw.approvedAt === 'string' ? raw.approvedAt : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
  }
}

export function sanitizeDraftStore(parsed: unknown): SanitizedDraftStore {
  const isolated: unknown[] = []
  const valid: StoredRuleDraft[] = []
  const records = isRecord(parsed) && Array.isArray(parsed.drafts) ? parsed.drafts : []

  for (const entry of records) {
    const sanitized = sanitizeStoredRuleDraft(entry)
    if (sanitized) valid.push(sanitized)
    else isolated.push(entry)
  }

  const state: RuleDraftStoreState = {
    schemaVersion: RULE_DRAFT_SCHEMA_VERSION,
    drafts: valid,
    migrationCompleted: isRecord(parsed) && parsed.migrationCompleted === true
  }

  return {
    state,
    isolated,
    changed: isolated.length > 0 || valid.length !== records.length
  }
}

function sanitizePackRules(rules: unknown[], builtinIds: string[]): RuleConfig[] {
  const valid: RuleConfig[] = []
  for (const raw of rules) {
    const rule = validateRuleInput(raw, { builtinIds })
    if (rule) valid.push(rule)
  }
  return valid
}

function sanitizePackManifest(
  raw: unknown,
  reservedRuleIds: string[],
  officialPackIds: Set<string>
): RulePackManifest | null {
  if (!isRecord(raw)) return null
  if (raw.schemaVersion !== RULE_PACK_SCHEMA_VERSION) return null
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  if (typeof raw.version !== 'string') return null
  if (raw.origin !== 'official' && raw.origin !== 'user-import' && raw.origin !== 'agent-generated' && raw.origin !== 'legacy-user') {
    return null
  }
  if (raw.platform !== 'windows') return null
  if (!Array.isArray(raw.rules)) return null
  if (officialPackIds.has(raw.id)) return null

  const rules = sanitizePackRules(raw.rules, [...reservedRuleIds, raw.id])
  if (rules.length === 0) return null

  return {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    version: raw.version,
    origin: raw.origin,
    platform: 'windows',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    rules
  }
}

export function sanitizeUserPackStore(parsed: unknown): SanitizedPackStore {
  const isolatedPacks: unknown[] = []
  const packs: RulePackManifest[] = []
  const userRuleIds: string[] = []

  const officialPacks = loadOfficialRulePacks()
  const officialPackIds = new Set(officialPacks.map((pack) => pack.id))
  const reservedRuleIds = officialPacks.flatMap((pack) => pack.rules.map((rule) => rule.id))

  if (isRecord(parsed) && Array.isArray(parsed.packs)) {
    for (const entry of parsed.packs) {
      const pack = sanitizePackManifest(entry, [...reservedRuleIds, ...userRuleIds], officialPackIds)
      if (pack) {
        packs.push(pack)
        userRuleIds.push(...pack.rules.map((rule) => rule.id))
      } else {
        isolatedPacks.push(entry)
      }
    }
  }

  const disabledPackIds =
    isRecord(parsed) && Array.isArray(parsed.disabledPackIds)
      ? parsed.disabledPackIds.filter((id): id is string => typeof id === 'string')
      : []

  const state: UserRulePackState = {
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    disabledPackIds,
    packs
  }

  const originalPackCount = isRecord(parsed) && Array.isArray(parsed.packs) ? parsed.packs.length : 0
  return {
    state,
    isolatedPacks,
    changed: isolatedPacks.length > 0 || packs.length !== originalPackCount
  }
}

export function assertImportJsonSize(raw: string, maxBytes: number): void {
  if (Buffer.byteLength(raw, 'utf-8') > maxBytes) {
    throw new RuleDraftValidationError('JSON 文件过大')
  }
}
