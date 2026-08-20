import { shell } from 'electron'
import { existsSync, lstatSync } from 'fs'

export async function openInExplorer(targetPath: string): Promise<void> {
  if (!existsSync(targetPath)) {
    throw new Error('路径不存在或无法访问')
  }

  const stat = lstatSync(targetPath)
  if (stat.isDirectory()) {
    const error = await shell.openPath(targetPath)
    if (error) throw new Error(error)
    return
  }

  shell.showItemInFolder(targetPath)
}
