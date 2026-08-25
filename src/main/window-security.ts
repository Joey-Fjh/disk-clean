import { app, type BrowserWindow, type WebContents } from 'electron'
import { normalize } from 'path'

let mainWindow: BrowserWindow | null = null
let trustedSenderChecker: ((sender: WebContents) => boolean) | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
  trustedSenderChecker = null
}

/** 测试注入：覆盖主窗口 sender 判定。 */
export function setTrustedSenderCheckerForTests(
  checker: ((sender: WebContents) => boolean) | null
): void {
  trustedSenderChecker = checker
}

export function isTrustedMainWindowSender(sender: WebContents): boolean {
  if (trustedSenderChecker) {
    return trustedSenderChecker(sender)
  }
  return mainWindow !== null && sender.id === mainWindow.webContents.id
}

function normalizeFileUrlPath(fileUrl: string): string | null {
  try {
    const parsed = new URL(fileUrl)
    if (parsed.protocol !== 'file:') return null
    // 拒绝带 hostname 的 file URL（如 file://evilhost/C:/... 或 file://server/share/...）
    if (parsed.hostname) return null
    let pathname = decodeURIComponent(parsed.pathname)
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(pathname)) {
      pathname = pathname.slice(1)
    }
    return normalize(pathname)
  } catch {
    return null
  }
}

export function isAllowedRendererNavigationUrl(
  url: string,
  options: {
    devRendererUrl?: string
    isPackaged: boolean
    rendererIndexPath?: string
  }
): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') {
      if (!options.rendererIndexPath) {
        return false
      }
      const target = normalizeFileUrlPath(url)
      const allowed = normalize(options.rendererIndexPath)
      return target !== null && target.toLowerCase() === allowed.toLowerCase()
    }

    const devRendererUrl = options.devRendererUrl
    if (!options.isPackaged && devRendererUrl) {
      return parsed.origin === new URL(devRendererUrl).origin
    }

    return false
  } catch {
    return false
  }
}

export function hardenMainWindow(win: BrowserWindow, rendererIndexPath: string): void {
  const devRendererUrl = process.env.ELECTRON_RENDERER_URL
  const navigationOptions = {
    devRendererUrl,
    isPackaged: app.isPackaged,
    rendererIndexPath
  }

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigationUrl(url, navigationOptions)) {
      event.preventDefault()
    }
  })
}
