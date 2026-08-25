export type SettingsCardId = 'theme' | 'provider' | 'rules'

export class SettingsAccordion {
  private expandedId: SettingsCardId | null

  constructor(initial: SettingsCardId | null = 'provider') {
    this.expandedId = initial
  }

  getExpanded(): SettingsCardId | null {
    return this.expandedId
  }

  /** 点击卡片 Header：已展开则收起，否则展开该项并收起其他项。 */
  toggle(cardId: SettingsCardId): SettingsCardId | null {
    this.expandedId = this.expandedId === cardId ? null : cardId
    return this.expandedId
  }

  isExpanded(cardId: SettingsCardId): boolean {
    return this.expandedId === cardId
  }
}

export function applySettingsAccordionDom(
  accordion: SettingsAccordion,
  cardElements: Map<SettingsCardId, HTMLElement>
): void {
  for (const [id, card] of cardElements) {
    const expanded = accordion.isExpanded(id)
    const header = card.querySelector<HTMLButtonElement>('.settings-card-header')!
    const body = card.querySelector<HTMLElement>('.settings-card-body')!
    card.classList.toggle('is-expanded', expanded)
    header.setAttribute('aria-expanded', String(expanded))
    body.hidden = !expanded
  }
}
