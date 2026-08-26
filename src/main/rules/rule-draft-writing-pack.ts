import { AGENT_LIMITS } from '../../shared/agent-limits'
import type { RuleWritingPack, RuleWritingPackCandidate } from '../../shared/rule-layer-types'
import { RULE_DRAFT_FORBIDDEN_FIELDS, RULE_DRAFT_LIMITS } from '../../shared/rule-draft-limits'
import { RULE_DRAFT_SCHEMA_VERSION } from '../../shared/rule-layer-types'
import type { ScanItem } from '../../shared/types'
import type { ScanSession } from '../scan/scan-session-store'
import { buildAgentPromptPayload } from '../agent/agent-prompt'
import { sessionFingerprint } from './rule-draft-preview'

const SAFETY_CONSTRAINTS = [
  '不得包含绝对路径、用户名或 API Key',
  '不得包含 deletable/defaultChecked/nativeManaged 等授权字段',
  '不得包含 command/exec/script/shell 等可执行字段',
  '草稿必须经本机校验、匹配预览与用户批准后才能启用',
  'protected paths 始终优先于任何规则'
]

const PRIVACY_NOTES = [
  '编写包仅包含脱敏候选摘要与相对层级',
  '不会包含文件正文、日志内容或凭证',
  '导入 JSON 只会进入规则草稿区，不会直接获得清理权限'
]

export function buildRuleWritingPack(
  session: ScanSession,
  items: ScanItem[],
  candidateIds?: string[]
): RuleWritingPack {
  const selected =
    candidateIds && candidateIds.length > 0
      ? items.filter((item) => candidateIds.includes(item.id))
      : items

  if (selected.length > RULE_DRAFT_LIMITS.MAX_CANDIDATES_PER_REQUEST) {
    throw new Error(
      `编写包最多包含 ${RULE_DRAFT_LIMITS.MAX_CANDIDATES_PER_REQUEST} 个候选项，当前 ${selected.length} 个`
    )
  }

  const build = buildAgentPromptPayload(selected)

  const candidates: RuleWritingPackCandidate[] = build.payload.candidates.map((entry) => ({
    candidateRef: entry.candidateRef,
    contentType: entry.contentType,
    hierarchySummary: entry.hierarchySummary,
    logicalSize: entry.logicalSize,
    discoverySources: entry.discoverySources,
    localFeatures: entry.localFeatures,
    evidence: entry.evidence
  }))

  return {
    schemaVersion: '1',
    generatedAt: new Date().toISOString(),
    sessionId: session.sessionId,
    sessionFingerprint: sessionFingerprint(session),
    ruleDraftSchemaVersion: RULE_DRAFT_SCHEMA_VERSION,
    forbiddenFields: [...RULE_DRAFT_FORBIDDEN_FIELDS],
    safetyConstraints: SAFETY_CONSTRAINTS,
    privacyNotes: PRIVACY_NOTES,
    candidates
  }
}

export function estimateWritingPackBytes(pack: RuleWritingPack): number {
  return Buffer.byteLength(JSON.stringify(pack), 'utf-8')
}

export function assertWritingPackSafe(pack: RuleWritingPack): void {
  const raw = JSON.stringify(pack)
  if (raw.includes(':\\') || raw.includes('\\\\')) {
    throw new Error('编写包包含疑似绝对路径')
  }
  if (estimateWritingPackBytes(pack) > AGENT_LIMITS.MAX_REQUEST_BYTES) {
    throw new Error('编写包过大')
  }
}
