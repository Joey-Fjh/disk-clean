// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  SettingsAccordion,
  applySettingsAccordionDom,
  type SettingsCardId
} from '../src/renderer/settings-accordion'

function createCard(id: SettingsCardId, expanded = false): HTMLElement {
  const section = document.createElement('section')
  section.className = 'settings-card'
  section.dataset.settingsCard = id
  section.innerHTML = `
    <button type="button" class="settings-card-header" aria-expanded="${expanded}" aria-controls="body-${id}"></button>
    <div class="settings-card-body" id="body-${id}"${expanded ? '' : ' hidden'}></div>
  `
  return section
}

describe('settings accordion DOM', () => {
  it('sets aria-expanded and hides collapsed card bodies', () => {
    const accordion = new SettingsAccordion('provider')
    const cards = new Map<SettingsCardId, HTMLElement>([
      ['theme', createCard('theme')],
      ['provider', createCard('provider', true)],
      ['rules', createCard('rules')]
    ])

    applySettingsAccordionDom(accordion, cards)

    expect(cards.get('provider')?.querySelector('.settings-card-header')?.getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(cards.get('theme')?.querySelector('.settings-card-header')?.getAttribute('aria-expanded')).toBe(
      'false'
    )
    expect(cards.get('provider')?.querySelector('.settings-card-body')?.hasAttribute('hidden')).toBe(false)
    expect(cards.get('theme')?.querySelector('.settings-card-body')?.hasAttribute('hidden')).toBe(true)
  })

  it('keeps only one card expanded after toggle', () => {
    const accordion = new SettingsAccordion('provider')
    const cards = new Map<SettingsCardId, HTMLElement>([
      ['theme', createCard('theme')],
      ['provider', createCard('provider', true)],
      ['rules', createCard('rules')]
    ])

    accordion.toggle('rules')
    applySettingsAccordionDom(accordion, cards)

    expect(accordion.getExpanded()).toBe('rules')
    expect(cards.get('rules')?.classList.contains('is-expanded')).toBe(true)
    expect(cards.get('provider')?.classList.contains('is-expanded')).toBe(false)
  })
})
