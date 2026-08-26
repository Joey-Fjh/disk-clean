import { app } from 'electron'
import { join } from 'path'

export function getConfigDir(): string {
  const isPackaged = typeof app !== 'undefined' && app.isPackaged === true
  if (!isPackaged) {
    return join(process.cwd(), 'config')
  }
  return join(process.resourcesPath, 'config')
}
