import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import http from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import { runScan } from './scanner'
import { cancelScanSession } from './scanner/scan-controller'
import { runCleanup } from './cleanup/cleanup-service'
import { openInExplorer } from './explorer'
import {
  getAllRulesWithMeta,
  setRuleEnabled,
  removeCustomRule,
  importCustomRules,
  resetUserRules
} from './rules'
import { importRuleDraftFromJson } from './rules/rule-layer-service'
import type { RuleConfig, ScanProgress, ScanRequest } from '../shared/types'
import { MAX_CANDIDATE_ID_LENGTH, MAX_CLEANUP_CANDIDATE_IDS } from '../shared/cleanup-limits'
import { listAvailableDrives, getSystemDrive } from '../shared/system-paths'
import { registerProviderIpc } from './provider/provider-ipc'
import { registerAgentIpc } from './agent/agent-ipc'
import { registerRuleLayerIpc } from './rules/rule-layer-ipc'
import { hardenMainWindow, isTrustedMainWindowSender, setMainWindow } from './window-security'
import { RULE_DRAFT_LIMITS } from '../shared/rule-draft-limits'
import { assertImportJsonSize } from './rules/rule-store-sanitizer'

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
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  setMainWindow(mainWindow)
  hardenMainWindow(mainWindow, join(__dirname, '../renderer/index.html'))

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
  registerProviderIpc()
  registerAgentIpc()
  registerRuleLayerIpc()
  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('scan:start', async (_event, request: ScanRequest = {}) => {
  const sendProgress = (progress: ScanProgress) => {
    mainWindow?.webContents.send('scan:progress', progress)
  }
  const sendItems = (items: import('../shared/types').ScanItem[]) => {
    mainWindow?.webContents.send('scan:items', items)
  }
  return runScan(request, sendProgress, sendItems)
})

ipcMain.handle('scan:cancel', () => {
  cancelScanSession()
})

ipcMain.handle('system:listDrives', () => {
  const drives = listAvailableDrives().map((root) => root.replace(/\\$/, ''))
  return drives.length > 0 ? drives : [getSystemDrive()]
})

ipcMain.handle('cleanup:execute', async (event, request: unknown) => {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('未授权的清理请求')
  }
  if (!request || typeof request !== 'object') {
    throw new Error('无效的清理请求')
  }
  const payload = request as Record<string, unknown>
  if (typeof payload.sessionId !== 'string' || !payload.sessionId.trim()) {
    throw new Error('无效的扫描会话')
  }
  if (!Array.isArray(payload.candidateIds) || !payload.candidateIds.every((id) => typeof id === 'string')) {
    throw new Error('无效的候选项列表')
  }
  const candidateIds = payload.candidateIds as string[]
  if (candidateIds.length > MAX_CLEANUP_CANDIDATE_IDS) {
    throw new Error(`候选项数量超过上限 ${MAX_CLEANUP_CANDIDATE_IDS}`)
  }
  if (candidateIds.some((id) => id.length > MAX_CANDIDATE_ID_LENGTH)) {
    throw new Error('候选项 ID 过长')
  }
  return runCleanup({
    sessionId: payload.sessionId.trim(),
    candidateIds
  })
})

ipcMain.handle('path:open', async (_event, targetPath: string) => {
  await openInExplorer(targetPath)
})

ipcMain.handle('rules:list', (event) => {
  if (!isTrustedMainWindowSender(event.sender)) throw new Error('未授权的规则请求')
  return getAllRulesWithMeta()
})

ipcMain.handle('rules:setEnabled', (event, ruleId: string, enabled: boolean) => {
  if (!isTrustedMainWindowSender(event.sender)) throw new Error('未授权的规则请求')
  setRuleEnabled(ruleId, enabled)
  return getAllRulesWithMeta()
})

ipcMain.handle('rules:remove', (event, ruleId: string) => {
  if (!isTrustedMainWindowSender(event.sender)) throw new Error('未授权的规则请求')
  const removed = removeCustomRule(ruleId)
  return { removed, rules: getAllRulesWithMeta() }
})

ipcMain.handle('rules:reset', (event) => {
  if (!isTrustedMainWindowSender(event.sender)) throw new Error('未授权的规则请求')
  resetUserRules()
  return getAllRulesWithMeta()
})

ipcMain.handle('rules:import', async (event) => {
  if (!isTrustedMainWindowSender(event.sender)) throw new Error('未授权的规则请求')
  const result = await dialog.showOpenDialog({
    title: '导入规则草稿 JSON',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) {
    return { imported: 0, rules: getAllRulesWithMeta(), draftOnly: true }
  }

  const raw = readFileSync(result.filePaths[0], 'utf-8')
  assertImportJsonSize(raw, RULE_DRAFT_LIMITS.MAX_DRAFT_JSON_BYTES)
  const parsed = JSON.parse(raw) as { rules?: RuleConfig[] } | RuleConfig[] | Record<string, unknown>
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'schemaVersion' in parsed) {
    importRuleDraftFromJson(parsed, raw)
    return { imported: 1, rules: getAllRulesWithMeta(), draftOnly: true }
  }
  const rules = Array.isArray(parsed) ? parsed : (parsed as { rules?: unknown[] }).rules ?? []
  const imported = importCustomRules(rules)
  return { imported, rules: getAllRulesWithMeta(), draftOnly: true }
})
