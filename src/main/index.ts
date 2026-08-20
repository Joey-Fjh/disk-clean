import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import http from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import { runScan } from './scanner'
import { runCleanup } from './cleanup/cleanup-service'
import { openInExplorer } from './explorer'
import {
  getAllRulesWithMeta,
  setRuleEnabled,
  removeCustomRule,
  importCustomRules,
  resetUserRules
} from './rules'
import type { CleanupRequest, RuleConfig, ScanMode, ScanProgress } from '../shared/types'

let mainWindow: BrowserWindow | null = null

function pingServer(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode !== undefined && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForDevServer(url: string, maxWaitMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    if (await pingServer(url)) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`开发服务器未就绪: ${url}`)
}

function loadURL(win: BrowserWindow, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoad = (): void => {
      cleanup()
      resolve()
    }
    const onFail = (_event: Electron.Event, code: number, desc: string): void => {
      cleanup()
      reject(new Error(`${code}: ${desc}`))
    }
    const cleanup = (): void => {
      win.webContents.removeListener('did-finish-load', onLoad)
      win.webContents.removeListener('did-fail-load', onFail)
    }

    win.webContents.once('did-finish-load', onLoad)
    win.webContents.once('did-fail-load', onFail)
    void win.loadURL(url)
  })
}

async function loadRenderer(win: BrowserWindow): Promise<void> {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const builtFile = join(__dirname, '../renderer/index.html')

  if (devUrl && !app.isPackaged) {
    try {
      await waitForDevServer(devUrl)
      await loadURL(win, devUrl)
      return
    } catch (err) {
      console.warn('Dev server load failed, falling back to built files:', err)
    }
  }

  await win.loadFile(builtFile)
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    title: 'Disk Clean',
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  try {
    await loadRenderer(mainWindow)
  } catch (err) {
    console.error('Failed to load renderer:', err)
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools()
    }
  }
}

app.whenReady().then(() => {
  app.setName('Disk Clean')
  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('scan:start', async (_event, mode: ScanMode = 'quick') => {
  const send = (progress: ScanProgress) => {
    mainWindow?.webContents.send('scan:progress', progress)
  }
  return runScan(mode, send)
})

ipcMain.handle('cleanup:execute', async (_event, request: CleanupRequest) => {
  return runCleanup(request)
})

ipcMain.handle('path:open', async (_event, targetPath: string) => {
  await openInExplorer(targetPath)
})

ipcMain.handle('rules:list', () => getAllRulesWithMeta())

ipcMain.handle('rules:setEnabled', (_event, ruleId: string, enabled: boolean) => {
  setRuleEnabled(ruleId, enabled)
  return getAllRulesWithMeta()
})

ipcMain.handle('rules:remove', (_event, ruleId: string) => {
  const removed = removeCustomRule(ruleId)
  return { removed, rules: getAllRulesWithMeta() }
})

ipcMain.handle('rules:reset', () => {
  resetUserRules()
  return getAllRulesWithMeta()
})

ipcMain.handle('rules:import', async () => {
  const result = await dialog.showOpenDialog({
    title: '导入规则 JSON',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) {
    return { imported: 0, rules: getAllRulesWithMeta() }
  }

  const raw = readFileSync(result.filePaths[0], 'utf-8')
  const parsed = JSON.parse(raw) as { rules?: RuleConfig[] } | RuleConfig[]
  const rules = Array.isArray(parsed) ? parsed : parsed.rules ?? []
  const imported = importCustomRules(rules)
  return { imported, rules: getAllRulesWithMeta() }
})
