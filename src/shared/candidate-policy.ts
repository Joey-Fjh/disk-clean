import type { Category } from './types'

export function shouldAutoSelect(
  rule: {
    defaultChecked: boolean
    category: Category
    source?: 'builtin' | 'custom'
  },
  snapshotComplete = true
): boolean {
  return (
    rule.defaultChecked === true &&
    rule.category === 'safe' &&
    rule.source !== 'custom' &&
    snapshotComplete
  )
}
