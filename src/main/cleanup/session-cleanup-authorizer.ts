import { buildSessionFingerprint } from '../../shared/candidate-ref-index'
import type { CleanupErrorCode } from '../../shared/cleanup-errors'
import {
  evaluateSessionCleanupAuthorization,
  type CleanupAuthorizationSource
} from '../../shared/session-cleanup-authorization'
import { isRuleOrdinaryDeletable } from '../../shared/rule-enforcement'
import type { ScanCandidate } from '../../shared/types'
import { getAllRulesWithMeta, getProtectedPaths } from '../rules'
import { isProtectedPath } from '../../shared/path-utils'
import type { ScanSession } from '../scan/scan-session-store'
import { resolveLocalJudgment } from '../../shared/candidate-judgment'
import { resolveExecutionSafety } from '../../shared/execution-safety'

export interface CandidateAuthorizationResult {
  candidate: ScanCandidate
  authorized: boolean
  source: CleanupAuthorizationSource
  code?: CleanupErrorCode
  message?: string
}

export function assertSessionFingerprint(session: ScanSession, fingerprint: string): boolean {
  return buildSessionFingerprint(session.sessionId, session.createdAt, session.revision) === fingerprint
}

export function authorizeSessionCandidates(
  session: ScanSession,
  candidateIds: string[]
): CandidateAuthorizationResult[] {
  const protectedPaths = getProtectedPaths()
  const rules = getAllRulesWithMeta()
  const results: CandidateAuthorizationResult[] = []

  for (const candidateId of candidateIds) {
    const candidate = session.candidates.get(candidateId)
    if (!candidate) {
      results.push({
        candidate: {
          id: candidateId,
          ruleId: '',
          ruleName: '',
          category: 'dangerous',
          contentType: 'system-protected',
          drive: '',
          path: candidateId,
          size: 0,
          sizeIsEstimate: false,
          snapshotComplete: false,
          entryKind: 'file',
          deletable: false,
          autoSelect: false,
          source: 'analyzer',
          discoverySources: [],
          evidence: [],
          judgment: {
            status: 'uncertain',
            source: 'none',
            confidence: 'unknown',
            basis: []
          },
          selection: { selectable: false },
          suggestedAction: 'none'
        },
        authorized: false,
        source: 'none',
        code: 'CANDIDATE_NOT_FOUND',
        message: '候选项不属于当前扫描会话'
      })
      continue
    }

    const rule = rules.find((entry) => entry.id === candidate.ruleId) ?? null
    const protectedPath = isProtectedPath(candidate.path, protectedPaths)
    const judgment = candidate.judgment ?? resolveLocalJudgment(candidate, protectedPath)
    const candidateForEval = {
      ...candidate,
      judgment,
      executionSafety:
        candidate.executionSafety ?? resolveExecutionSafety({ ...candidate, judgment }, protectedPath)
    }
    const evaluation = evaluateSessionCleanupAuthorization({
      candidate: candidateForEval,
      rule,
      protectedPath
    })

    if (evaluation.authorized && rule && !isRuleOrdinaryDeletable(rule)) {
      results.push({
        candidate,
        authorized: false,
        source: 'none',
        code: evaluation.code ?? 'ACTION_NOT_ALLOWED',
        message: evaluation.message ?? '该候选项不允许普通删除'
      })
      continue
    }

    if (!evaluation.authorized && evaluation.code === 'ACTION_NOT_ALLOWED') {
      results.push({
        candidate,
        authorized: false,
        source: 'none',
        code: evaluation.code,
        message: evaluation.message
      })
      continue
    }

    results.push({
      candidate,
      authorized: evaluation.authorized,
      source: evaluation.source,
      code: evaluation.code,
      message: evaluation.message
    })
  }

  return results
}
