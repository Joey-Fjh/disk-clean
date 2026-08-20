import { existsSync } from 'fs'
import type { ScanError, ScanItem, ScanProgress } from '../../shared/types'
import {
  formatDriveLabel,
  getSystemDriveScanTargets,
  getUsersRoot,
  isSystemDrive,
  listAvailableDrives
} from '../../shared/system-paths'
import { expandEnvVars, isProtectedPath } from '../../shared/path-utils'
import { getProtectedLabels, getProtectedPaths } from '../rules'
import { getPathSize } from './rule-scanner'
import { displayNameForPath, enrichCandidate, listImmediateChildren } from './rule-matcher'

type ProgressCallback = (progress: ScanProgress) => void

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
  if (!existsSync(path)) return null

  const size = await getPathSize(path)
  if (size === 0) return null

  const protectedHit = isProtectedPath(path, protectedPaths)
  const name = displayName ?? (protectedHit ? protectedLabel(path, protectedPaths, labels) : displayNameForPath(path))

  return enrichCandidate(path, size, {
    name,
    contentType: protectedHit ? 'system-protected' : 'large-dir',
    category: 'dangerous',
    deletable: false,
    reason: protectedHit ? '系统管理目录' : '磁盘空间占用分析',
    impact: protectedHit ? '不可直接删除' : '仅展示占用，不判断是否为垃圾'
  })
}

async function collectFullScanTargets(): Promise<string[]> {
  const targets = new Set<string>(getSystemDriveScanTargets())

  for (const drive of listAvailableDrives()) {
    if (isSystemDrive(drive)) continue

    const children = await listImmediateChildren(drive)
    if (children.length === 0) {
      targets.add(drive)
      continue
    }

    for (const child of children) {
      targets.add(child)
    }
  }

  return [...targets]
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

export async function runDiskAnalysis(onProgress?: ProgressCallback): Promise<{
  items: ScanItem[]
  errors: ScanError[]
}> {
  const protectedPaths = getProtectedPaths()
  const labels = getProtectedLabels()
  const targets = await collectFullScanTargets()
  const errors: ScanError[] = []
  const items: ScanItem[] = []

  for (let i = 0; i < targets.length; i++) {
    const path = expandEnvVars(targets[i])
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
      if (item) items.push(item)
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
  return { items, errors }
}

/** 展开系统盘 Users 下一级目录 */
export async function analyzeUserProfiles(onProgress?: ProgressCallback): Promise<ScanItem[]> {
  const usersRoot = getUsersRoot()
  if (!existsSync(usersRoot)) return []

  const protectedPaths = getProtectedPaths()
  const labels = getProtectedLabels()
  const children = await listImmediateChildren(usersRoot)

  const items: ScanItem[] = []
  for (let i = 0; i < children.length; i++) {
    const path = children[i]
    onProgress?.({
      mode: 'full',
      label: displayNameForPath(path),
      category: 'dangerous',
      status: 'scanning',
      current: i + 1,
      total: children.length,
      categoryCurrent: i + 1,
      categoryTotal: children.length
    })

    const item = await analyzePath(path, protectedPaths, labels)
    if (item) items.push(item)
  }

  return items.sort((a, b) => b.size - a.size)
}
