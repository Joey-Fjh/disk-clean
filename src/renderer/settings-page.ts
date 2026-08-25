import { SettingsAccordion, applySettingsAccordionDom, type SettingsCardId } from './settings-accordion'

const accordion = new SettingsAccordion('provider')
const settingsPanel = document.getElementById('panel-settings')!
const cardElements = new Map<SettingsCardId, HTMLElement>()

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function syncAccordionDom(): void {
  applySettingsAccordionDom(accordion, cardElements)
}

function scrollCardHeaderIntoView(cardId: SettingsCardId): void {
  const card = cardElements.get(cardId)
  const header = card?.querySelector<HTMLButtonElement>('.settings-card-header')
  if (!header) return
  header.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'nearest'
  })
}

export function initSettingsAccordion(): SettingsAccordion {
  const cards = settingsPanel.querySelectorAll<HTMLElement>('.settings-card[data-settings-card]')
  cards.forEach((card) => {
    const id = card.dataset.settingsCard as SettingsCardId
    cardElements.set(id, card)
    const header = card.querySelector<HTMLButtonElement>('.settings-card-header')!
    header.addEventListener('click', () => {
      const wasExpanded = accordion.isExpanded(id)
      accordion.toggle(id)
      syncAccordionDom()
      const nowExpanded = accordion.isExpanded(id)
      if (nowExpanded && !wasExpanded) {
        scrollCardHeaderIntoView(id)
      }
    })
  })
  syncAccordionDom()
  return accordion
}

export function getSettingsAccordion(): SettingsAccordion {
  return accordion
}

initSettingsAccordion()
