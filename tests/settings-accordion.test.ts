import { describe, expect, it } from 'vitest'
import { SettingsAccordion } from '../src/renderer/settings-accordion'

describe('SettingsAccordion', () => {
  it('defaults to provider expanded', () => {
    const accordion = new SettingsAccordion('provider')
    expect(accordion.getExpanded()).toBe('provider')
    expect(accordion.isExpanded('provider')).toBe(true)
    expect(accordion.isExpanded('theme')).toBe(false)
  })

  it('allows only one expanded card at a time', () => {
    const accordion = new SettingsAccordion('provider')
    accordion.toggle('rules')
    expect(accordion.getExpanded()).toBe('rules')
    expect(accordion.isExpanded('provider')).toBe(false)
    accordion.toggle('theme')
    expect(accordion.getExpanded()).toBe('theme')
  })

  it('collapses when clicking the expanded card again', () => {
    const accordion = new SettingsAccordion('provider')
    accordion.toggle('provider')
    expect(accordion.getExpanded()).toBeNull()
  })

  it('does not clear state when collapsing', () => {
    const accordion = new SettingsAccordion('provider')
    const before = accordion.getExpanded()
    accordion.toggle('provider')
    accordion.toggle('provider')
    expect(accordion.getExpanded()).toBe('provider')
    expect(before).toBe('provider')
  })
})
