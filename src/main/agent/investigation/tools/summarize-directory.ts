import { join, extname } from 'path'
import { lstat } from 'fs/promises'
import { INVESTIGATION_LIMITS } from '../../../../shared/investigation-limits'
import type { InvestigationSummarizeDirectoryResult } from '../../../../shared/investigation-types'
import { throwIfAborted, type InvestigationAbortReason } from '../investigation-abort'
import { InvestigationError } from '../investigation-errors'
import { iterateDirectoryEntries } from '../directory-iterator'
import { assertDirectoryTarget, type ResolvedInvestigationPath } from '../path-security'
import { resolveDirectoryDepth } from '../tool-params'
import {
  assertResponseWithinLimit,
  measureJsonBytes,
  sanitizeUntrustedName,
  UNTRUSTED_DATA_NOTICE
} from '../tool-result-sanitize'

class TraversalBudget {
  entries = 0
  directories = 0
  truncated = false

  visitEntry(): boolean {
    this.entries += 1
    if (this.entries > INVESTIGATION_LIMITS.MAX_TRAVERSED_ENTRIES) {
      this.truncated = true
      return false
    }
    return true
  }

  visitDirectory(): boolean {
    this.directories += 1
    if (this.directories > INVESTIGATION_LIMITS.MAX_TRAVERSED_DIRECTORIES) {
      this.truncated = true
      return false
    }
    return true
  }
}

async function summarizeAt(
  targetPath: string,
  depth: number,
  maxDepth: number,
  budget: TraversalBudget,
  signal: AbortSignal | undefined,
  resolveAbortReason: () => InvestigationAbortReason | null
): Promise<{
  fileCount: number
  directoryCount: number
  symlinkCount: number
  otherCount: number
  totalBytes: number
  extensionCounts: Record<string, number>
  truncated: boolean
}> {
  throwIfAborted(signal, resolveAbortReason)

  const summary = {
    fileCount: 0,
    directoryCount: 0,
    symlinkCount: 0,
    otherCount: 0,
    totalBytes: 0,
    extensionCounts: {} as Record<string, number>,
    truncated: false
  }

  const iteration = await iterateDirectoryEntries(targetPath, {
    signal,
    resolveAbortReason,
    onEntry: async (dirent) => {
      throwIfAborted(signal, resolveAbortReason)
      if (!budget.visitEntry()) {
        summary.truncated = true
        return 'stop'
      }

      const childPath = join(targetPath, dirent.name)
      if (dirent.isSymbolicLink()) {
        summary.symlinkCount += 1
        return 'continue'
      }

      let info
      try {
        info = await lstat(childPath)
        if (info.isSymbolicLink()) {
          summary.symlinkCount += 1
          return 'continue'
        }
      } catch {
        summary.otherCount += 1
        return 'continue'
      }

      if (info.isDirectory()) {
        summary.directoryCount += 1
        if (depth < maxDepth && budget.visitDirectory()) {
          const child = await summarizeAt(childPath, depth + 1, maxDepth, budget, signal, resolveAbortReason)
          summary.fileCount += child.fileCount
          summary.directoryCount += child.directoryCount
          summary.symlinkCount += child.symlinkCount
          summary.otherCount += child.otherCount
          summary.totalBytes += child.totalBytes
          for (const [ext, count] of Object.entries(child.extensionCounts)) {
            summary.extensionCounts[ext] = (summary.extensionCounts[ext] ?? 0) + count
          }
          if (child.truncated) summary.truncated = true
        } else {
          summary.truncated = true
        }
        return budget.truncated ? 'stop' : 'continue'
      }

      if (info.isFile()) {
        summary.fileCount += 1
        summary.totalBytes += info.size
        const ext = extname(dirent.name).replace(/^\./, '').toLowerCase() || '<none>'
        const safeExt = sanitizeUntrustedName(ext).value
        summary.extensionCounts[safeExt] = (summary.extensionCounts[safeExt] ?? 0) + 1
        return 'continue'
      }

      summary.otherCount += 1
      return budget.truncated ? 'stop' : 'continue'
    }
  })

  if (iteration.truncated || budget.truncated) summary.truncated = true
  return summary
}

export async function summarizeDirectoryTool(
  resolved: ResolvedInvestigationPath,
  depth: number | undefined,
  signal: AbortSignal | undefined,
  resolveAbortReason: () => InvestigationAbortReason | null
): Promise<InvestigationSummarizeDirectoryResult> {
  throwIfAborted(signal, resolveAbortReason)
  await assertDirectoryTarget(resolved.targetPath)

  const maxDepth = resolveDirectoryDepth(depth)
  const budget = new TraversalBudget()
  const summary = await summarizeAt(resolved.targetPath, 0, maxDepth, budget, signal, resolveAbortReason)

  const result: InvestigationSummarizeDirectoryResult = {
    tool: 'summarize_directory',
    relativePath: resolved.relativePath || '.',
    summary,
    untrustedDataNotice: UNTRUSTED_DATA_NOTICE
  }
  assertResponseWithinLimit(measureJsonBytes(result))
  return result
}
