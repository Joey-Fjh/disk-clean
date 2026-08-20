import { existsSync } from 'fs'
import { join } from 'path'

export function getSystemDrive(): string {
  const drive = process.env.SystemDrive ?? 'C:'
  return drive.endsWith(':') ? drive : `${drive}:`
}

export function getSystemDriveRoot(): string {
  return `${getSystemDrive()}\\`
}

export function getSystemRoot(): string {
  return process.env.SystemRoot ?? join(getSystemDriveRoot(), 'Windows')
}

export function getProgramFiles(): string {
  return process.env.ProgramFiles ?? join(getSystemDriveRoot(), 'Program Files')
}

export function getProgramFilesX86(): string {
  return process.env['ProgramFiles(x86)'] ?? join(getSystemDriveRoot(), 'Program Files (x86)')
}

export function getProgramData(): string {
  return process.env.ProgramData ?? join(getSystemDriveRoot(), 'ProgramData')
}

export function getUsersRoot(): string {
  return join(getSystemDriveRoot(), 'Users')
}

/** 本机存在的盘符根目录，如 D:\、E:\ */
export function listAvailableDrives(): string[] {
  const drives: string[] = []
  for (let code = 65; code <= 90; code++) {
    const root = `${String.fromCharCode(code)}:\\`
    try {
      if (existsSync(root)) drives.push(root)
    } catch {
      // 无权限或不存在
    }
  }
  return drives
}

export function isSystemDrive(driveRoot: string): boolean {
  return driveRoot.replace(/\//g, '\\').toLowerCase() === getSystemDriveRoot().toLowerCase()
}

export function formatDriveLabel(driveRoot: string): string {
  const letter = driveRoot.replace(/\\$/g, '')
  return isSystemDrive(driveRoot) ? `${letter}（系统盘）` : `${letter} 盘`
}

export function getSystemDriveScanTargets(): string[] {
  const systemRoot = getSystemRoot()
  return [
    getProgramFiles(),
    getProgramFilesX86(),
    systemRoot,
    getProgramData(),
    join(systemRoot, 'WinSxS'),
    join(systemRoot, 'Installer')
  ]
}
