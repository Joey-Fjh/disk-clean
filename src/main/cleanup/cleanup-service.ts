import type { CleanupRequest, CleanupResult } from '../../shared/types'
import { buildCleanupPlan } from './plan-builder'
import { validateCleanupActions } from './safety-validator'
import { executeCleanup } from './cleaner'

export async function runCleanup(request: CleanupRequest): Promise<CleanupResult> {
  const plan = buildCleanupPlan(request.items)
  const { approved, rejected } = await validateCleanupActions(plan.actions)
  return executeCleanup(plan.id, approved, rejected)
}
