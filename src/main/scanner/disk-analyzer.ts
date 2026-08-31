import { lstat } from 'fs/promises'
import type { ScanError, ScanItem, ScanProgress } from '../../shared/types'
import { formatDriveLabel, isSystemDrive, listAvailableDrives } from '../../shared/system-paths'
import { expandEnvVars, isProtectedPath, matchesDriveFilter } from '../../shared/path-utils'
import { getProtectedLabels, getProtectedPaths } from '../rules'
import { ANALYZER_MEASURE_MAX_DEPTH, measurePathDetailed } from './measure-size'
import { displayNameForPath, enrichCandidate, listDriveRootEntries } from './rule-matcher'
import { isScanCancelled } from './scan-controller'

type ProgressCallback = (progress: ScanProgress) => void
type ItemsCallback = (items: ScanItem[]) => void

function protectedLabel(path: string, protectedPaths: string[], labels: Record<string, string>): string {
  const normalized = path.toLowerCase()
  for (const [entry, label] of Object.entries(labels)) {
    const expanded = expandEnvVars(entry).toLowerCase()
    if (normalized === expanded || normalized.startsWith(expanded + '\\')) {
      return label
    }
  }

  for (const entry of protectedPaths) {
    const expanded = expandEnvVars(entry).toLowerCase()
    if (normalized === expanded || normalized.startsWith(expanded + '\\')) {
      return labels[entry] ?? displayNameForPath(path)
    }
  }

  return displayNameForPath(path)
}

async function analyzePath(
  path: string,
  protectedPaths: string[],
  labels: Record<string, string>,
  displayName?: string
): Promise<ScanItem | null> {
  if (isScanCancelled()) return null

  const info = await lstat(path).catch(() => null)
  if (!info || info.isSymbolicLink()) return null

  let size = 0
  let sizePartial = false
  const entryKind = info.isFile() ? 'file' : 'directory'

  if (info.isFile()) {
    size = info.size
  } else {
    const measured = await measurePathDetailed(path, ANALYZER_MEASURE_MAX_DEPTH, undefined, true)
    size = measured.size
    sizePartial = measured.incomplete
  }

  if (size === 0) return null

  const protectedHit = isProtectedPath(path, protectedPaths)
  const name = displayName ?? (protectedHit ? protectedLabel(path, protectedPaths, labels) : displayNameForPath(path))
  const reasonBase = protectedHit ? '系统管理目录' : '磁盘空间占用分析（逻辑大小估算）'
  const reason = sizePartial ? `${reasonBase}，深度受限可能不完整` : reasonBase

  return enrichCandidate(path, size, {
      name,
      contentType: protectedHit ? 'system-protected' : info.isFile() ? 'large-file' : 'large-dir',
      category: 'recommended',
      deletable: false,
      reason,
      impact: protectedHit ? '仅统计空间占用，不提供普通删除授权' : '仅展示占用，不判断是否为垃圾',
      entryKind,
      sizePartial
    })
}

async function collectTargetsForDrive(driveFilter: string): Promise<string[]> {
  const driveRoots =
    driveFilter === 'all'
      ? listAvailableDrives()
      : [driveFilter.endsWith(':') ? `${driveFilter}\\` : driveFilter]

  const targets: string[] = []
  for (const root of driveRoots) {
    if (!matchesDriveFilter(root, driveFilter)) continue
    targets.push(...(await listDriveRootEntries(root)))
  }
  return targets
}

function displayNameForTarget(path: string): string {
  const driveMatch = /^[A-Z]:\\$/i.exec(path)
  if (driveMatch) return formatDriveLabel(path)

  for (const drive of listAvailableDrives()) {
    if (!isSystemDrive(drive) && path.toLowerCase() === drive.toLowerCase()) {
      return formatDriveLabel(path)
    }
  }

  return displayNameForPath(path)
}

export async function runDiskAnalysis(
  driveFilter = 'all',
  onProgress?: ProgressCallback,
  onItems?: ItemsCallback
): Promise<{
  items: ScanItem[]
  errors: ScanError[]
  cancelled?: boolean
}> {
  const protectedPaths = getProtectedPaths()
  const labels = getProtectedLabels()
  const targets = await collectTargetsForDrive(driveFilter)
  const errors: ScanError[] = []
  const items: ScanItem[] = []

  for (let i = 0; i < targets.length; i++) {
    if (isScanCancelled()) break

    const path = expandEnvVars(targets[i])
    if (!matchesDriveFilter(path, driveFilter)) continue

    const label = displayNameForTarget(path)

    onProgress?.({
      mode: 'full',
      label,
      category: 'dangerous',
      status: 'scanning',
      current: i + 1,
      total: targets.length,
      categoryCurrent: i + 1,
      categoryTotal: targets.length
    })

    try {
      const item = await analyzePath(path, protectedPaths, labels, label)
      if (item) {
        items.push(item)
        onItems?.([item])
      }
    } catch (err) {
      errors.push({
        ruleId: '__analyzer__',
        path,
        message: err instanceof Error ? err.message : String(err)
      })
    }

    onProgress?.({
      mode: 'full',
      label,
      category: 'dangerous',
      status: 'done',
      current: i + 1,
      total: targets.length,
      categoryCurrent: i + 1,
      categoryTotal: targets.length
    })
  }

  items.sort((a, b) => b.size - a.size)
  return { items, errors, cancelled: isScanCancelled() }
}
