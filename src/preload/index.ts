import { contextBridge, ipcRenderer } from 'electron'
import type {
  CleanupRequest,
  CleanupResult,
  RuleWithMeta,
  ScanMode,
  ScanProgress,
  ScanResult
} from '../shared/types'

contextBridge.exposeInMainWorld('diskClean', {
  startScan: (mode: ScanMode): Promise<ScanResult> => ipcRenderer.invoke('scan:start', mode),
  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => callback(progress)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },
  executeCleanup: (request: CleanupRequest): Promise<CleanupResult> =>
    ipcRenderer.invoke('cleanup:execute', request),
  listRules: (): Promise<RuleWithMeta[]> => ipcRenderer.invoke('rules:list'),
  setRuleEnabled: (ruleId: string, enabled: boolean): Promise<RuleWithMeta[]> =>
    ipcRenderer.invoke('rules:setEnabled', ruleId, enabled),
  removeRule: (ruleId: string): Promise<{ removed: boolean; rules: RuleWithMeta[] }> =>
    ipcRenderer.invoke('rules:remove', ruleId),
  resetRules: (): Promise<RuleWithMeta[]> => ipcRenderer.invoke('rules:reset'),
  importRules: (): Promise<{ imported: number; rules: RuleWithMeta[] }> =>
    ipcRenderer.invoke('rules:import'),
  openInExplorer: (targetPath: string): Promise<void> => ipcRenderer.invoke('path:open', targetPath)
})
