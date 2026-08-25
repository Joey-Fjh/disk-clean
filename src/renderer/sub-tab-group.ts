export interface SubTabDefinition {
  id: string
  label: string
}

export class SubTabGroup {
  private activeId: string

  constructor(
    private readonly tabs: SubTabDefinition[],
    initialId?: string
  ) {
    this.activeId = initialId ?? tabs[0]?.id ?? ''
  }

  getActiveId(): string {
    return this.activeId
  }

  activate(tabId: string): string {
    if (!this.tabs.some((tab) => tab.id === tabId)) {
      return this.activeId
    }
    this.activeId = tabId
    return this.activeId
  }
}

export function applySubTabDom(
  root: HTMLElement,
  group: SubTabGroup,
  options: {
    tabSelector?: string
    panelAttr?: string
  } = {}
): void {
  const tabSelector = options.tabSelector ?? '[role="tab"]'
  const panelAttr = options.panelAttr ?? 'data-subtab-panel'
  const activeId = group.getActiveId()

  root.querySelectorAll<HTMLElement>(tabSelector).forEach((tab) => {
    const id = tab.dataset.subtab ?? ''
    const selected = id === activeId
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
  })

  root.querySelectorAll<HTMLElement>(`[${panelAttr}]`).forEach((panel) => {
    const match = panel.getAttribute(panelAttr) === activeId
    panel.hidden = !match
  })
}
