import { join } from 'path'
import { lstat } from 'fs/promises'
import type { InvestigationSampleNamesResult } from '../../../../shared/investigation-types'
import { throwIfAborted, type InvestigationAbortReason } from '../investigation-abort'
import { InvestigationError } from '../investigation-errors'
import { iterateDirectoryEntries } from '../directory-iterator'
import { assertDirectoryTarget, type ResolvedInvestigationPath } from '../path-security'
import { resolveSampleLimit } from '../tool-params'
import {
  assertResponseWithinLimit,
  measureJsonBytes,
  sanitizeUntrustedName,
  UNTRUSTED_DATA_NOTICE
} from '../tool-result-sanitize'

export async function sampleEntryNamesTool(
  resolved: ResolvedInvestigationPath,
  limit: number | undefined,
  signal: AbortSignal | undefined,
  resolveAbortReason: () => InvestigationAbortReason | null
): Promise<InvestigationSampleNamesResult> {
  throwIfAborted(signal, resolveAbortReason)
  await assertDirectoryTarget(resolved.targetPath)

  const cappedLimit = resolveSampleLimit(limit)
  const names: string[] = []
  let truncated = false

  const iteration = await iterateDirectoryEntries(resolved.targetPath, {
    signal,
    resolveAbortReason,
    maxEntriesToRead: cappedLimit + 1,
    onEntry: async (dirent) => {
      throwIfAborted(signal, resolveAbortReason)
      if (names.length >= cappedLimit) {
        truncated = true
        return 'stop'
      }

      const childPath = join(resolved.targetPath, dirent.name)
      if (dirent.isSymbolicLink()) return 'continue'
      try {
        const info = await lstat(childPath)
        if (info.isSymbolicLink()) return 'continue'
      } catch {
        return 'continue'
      }

      names.push(sanitizeUntrustedName(dirent.name).value)
      return 'continue'
    }
  })

  if (iteration.truncated) truncated = true

  const result: InvestigationSampleNamesResult = {
    tool: 'sample_entry_names',
    relativePath: resolved.relativePath || '.',
    names,
    truncated,
    untrustedDataNotice: UNTRUSTED_DATA_NOTICE
  }
  assertResponseWithinLimit(measureJsonBytes(result))
  return result
}
