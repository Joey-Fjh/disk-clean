import { shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { CleanupError, CleanupResult } from '../../shared/types'
import type { ValidatedAction } from './safety-validator'

function getAuditLogPath(): string {
  const logDir = join(process.env.APPDATA ?? '', 'disk-clean', 'logs')
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  return join(logDir, 'audit.log')
}

function writeAudit(entry: Record<string, unknown>): void {
  try {
    appendFileSync(getAuditLogPath(), JSON.stringify(entry) + '\n', 'utf-8')
  } catch (err) {
    console.warn('Audit log write failed:', err)
  }
}

export async function executeCleanup(
  planId: string,
  actions: ValidatedAction[],
  rejected: Array<{ path: string; reason: string }>
): Promise<CleanupResult> {
  const succeeded: string[] = []
  const errors: CleanupError[] = []
  let movedToTrashBytes = 0

  for (const action of actions) {
    try {
      await shell.trashItem(action.resolvedPath)
      succeeded.push(action.resolvedPath)
      movedToTrashBytes += action.estimatedLogicalBytes
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : undefined
      errors.push({ path: action.resolvedPath, message, code })
    }
  }

  const result: CleanupResult = {
    planId,
    estimatedLogicalBytes: actions.reduce((s, a) => s + a.estimatedLogicalBytes, 0),
    movedToTrashBytes,
    actuallyReclaimedBytes: 0,
    reclaimState: 'pending',
    recoveryMode: 'recycle-bin',
    moved: succeeded.length,
    skipped: rejected.length,
    failed: errors.length,
    succeeded,
    errors,
    rejected
  }

  writeAudit({
    time: new Date().toISOString(),
    action: 'cleanup',
    planId,
    moved: result.moved,
    failed: result.failed,
    skipped: result.skipped,
    movedToTrashBytes: result.movedToTrashBytes,
    reclaimState: result.reclaimState,
    paths: succeeded
  })

  return result
}
