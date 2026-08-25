const panelScrollTop = new Map<string, number>()

export function savePanelScrollTop(panel: HTMLElement): void {
  panelScrollTop.set(panel.id, panel.scrollTop)
}

export function restorePanelScrollTop(panel: HTMLElement): void {
  const saved = panelScrollTop.get(panel.id)
  if (saved !== undefined) {
    panel.scrollTop = saved
  }
}

/** 在 DOM 变更前后保持面板滚动位置（用于增量结果渲染）。 */
export function preservePanelScrollTop(panel: HTMLElement, mutate: () => void): void {
  const top = panel.scrollTop
  mutate()
  panel.scrollTop = top
}

export function switchMainTabPanel(
  panels: NodeListOf<HTMLElement>,
  targetPanelId: string
): void {
  const current = document.querySelector<HTMLElement>('.tab-panel.active')
  if (current) {
    savePanelScrollTop(current)
  }

  panels.forEach((panel) => {
    const isActive = panel.id === targetPanelId
    panel.classList.toggle('active', isActive)
    if (isActive) {
      restorePanelScrollTop(panel)
    }
  })
}
