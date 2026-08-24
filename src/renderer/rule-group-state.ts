import type { Category } from '../shared/types'

export class RuleGroupExpansionState {
  private readonly expandedByCategory = new Map<Category, Set<string>>()

  clear(): void {
    this.expandedByCategory.clear()
  }

  isExpanded(category: Category, ruleName: string, isFirstInCategory: boolean): boolean {
    const expanded = this.expandedByCategory.get(category)
    if (!expanded) {
      if (isFirstInCategory) {
        this.expandedByCategory.set(category, new Set([ruleName]))
        return true
      }
      this.expandedByCategory.set(category, new Set())
      return false
    }
    return expanded.has(ruleName)
  }

  setExpanded(category: Category, ruleName: string, expanded: boolean): void {
    let names = this.expandedByCategory.get(category)
    if (!names) {
      names = new Set()
      this.expandedByCategory.set(category, names)
    }
    if (expanded) names.add(ruleName)
    else names.delete(ruleName)
  }
}
