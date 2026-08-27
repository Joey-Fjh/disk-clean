import { join } from 'path'
import { lstat } from 'fs/promises'
import type {
  InvestigationChildEntry,
  InvestigationListChildrenResult
} from '../../../../shared/investigation-types'
import { throwIfAborted } from '../investigation-abort'
import { InvestigationError } from '../investigation-errors'
import { iterateDirectoryEntries } from '../directory-iterator'
import { assertDirectoryTarget, type ResolvedInvestigationPath } from '../path-security'
import { resolveListLimit } from '../tool-params'
import {
  assertResponseWithinLimit,
  measureJsonBytes,
  sanitizeUntrustedName,
  UNTRUSTED_DATA_NOTICE
} from '../tool-result-sanitize'
import type { InvestigationAbortReason } from '../investigation-abort'

function entryKindFromDirent(entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): InvestigationChildEntry['kind'] {
  if (entry.isSymbolicLink()) return 'symlink'
  if (entry.isDirectory()) return 'directory'
  if (entry.isFile()) return 'file'
  return 'other'
}

export async function listChildrenTool(
  resolved: ResolvedInvestigationPath,
  limit: number | undefined,
  signal: AbortSignal | undefined,
  resolveAbortReason: () => InvestigationAbortReason | null
): Promise<InvestigationListChildrenResult> {
  throwIfAborted(signal, resolveAbortReason)
  await assertDirectoryTarget(resolved.targetPath)

  const cappedLimit = resolveListLimit(limit)
  const entries: InvestigationChildEntry[] = []
  let truncated = false

  const iteration = await iterateDirectoryEntries(resolved.targetPath, {
    signal,
    resolveAbortReason,
    maxEntriesToRead: cappedLimit + 1,
    onEntry: async (dirent) => {
      throwIfAborted(signal, resolveAbortReason)
      if (entries.length >= cappedLimit) {
        truncated = true
        return 'stop'
      }

      const childPath = join(resolved.targetPath, dirent.name)
      if (dirent.isSymbolicLink()) {
        entries.push({
          name: sanitizeUntrustedName(dirent.name).value,
          kind: 'symlink',
          size: 0,
          truncatedName: sanitizeUntrustedName(dirent.name).truncated
        })
        return 'continue'
      }

      let size = 0
      try {
        const info = await lstat(childPath)
        if (info.isSymbolicLink()) {
          entries.push({
            name: sanitizeUntrustedName(dirent.name).value,
            kind: 'symlink',
            size: 0,
            truncatedName: sanitizeUntrustedName(dirent.name).truncated
          })
          return 'continue'
        }
        size = info.isFile() ? info.size : 0
      } catch {
        size = 0
      }

      const sanitized = sanitizeUntrustedName(dirent.name)
      entries.push({
        name: sanitized.value,
        kind: entryKindFromDirent(dirent),
        size,
        truncatedName: sanitized.truncated
      })
      return 'continue'
    }
  })

  if (iteration.truncated) truncated = true

  const result: InvestigationListChildrenResult = {
    tool: 'list_children',
    relativePath: resolved.relativePath || '.',
    entries,
    truncated,
    untrustedDataNotice: UNTRUSTED_DATA_NOTICE
  }
  assertResponseWithinLimit(measureJsonBytes(result))
  return result
}
