import { opendir } from 'fs/promises'
import type { Dirent } from 'fs'
import { throwIfAborted, type InvestigationAbortReason } from './investigation-abort'
import { InvestigationError } from './investigation-errors'

export interface DirectoryIterationResult {
  truncated: boolean
  entriesRead: number
}

export async function iterateDirectoryEntries(
  dirPath: string,
  options: {
    signal?: AbortSignal
    resolveAbortReason?: () => InvestigationAbortReason | null
    maxEntriesToRead?: number
    onEntry: (entry: Dirent) => Promise<'continue' | 'stop'>
  }
): Promise<DirectoryIterationResult> {
  let dir: Awaited<ReturnType<typeof opendir>> | null = null
  let entriesRead = 0
  let truncated = false

  try {
    dir = await opendir(dirPath)
    for await (const entry of dir) {
      throwIfAborted(options.signal, options.resolveAbortReason ?? (() => null))
      entriesRead += 1
      if (options.maxEntriesToRead !== undefined && entriesRead > options.maxEntriesToRead) {
        truncated = true
        break
      }
      const action = await options.onEntry(entry)
      if (action === 'stop') break
    }
  } catch (error) {
    if (error instanceof InvestigationError) throw error
    throw new InvestigationError('IO_ERROR', '无法读取目录内容')
  } finally {
    await dir?.close().catch(() => undefined)
  }

  return { truncated, entriesRead }
}
