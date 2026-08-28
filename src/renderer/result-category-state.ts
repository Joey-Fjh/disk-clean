import type { ScanItem } from '../shared/types'
import {
  type CleanupDisplayCategory,
  CLEANUP_DISPLAY_CATEGORY_ORDER,
  firstDisplayCategoryWithItems,
  groupItemsByDisplayCategory
} from '../shared/cleanup-display-category'

export {
  type CleanupDisplayCategory,
  CLEANUP_DISPLAY_CATEGORY_ORDER,
  firstDisplayCategoryWithItems,
  groupItemsByDisplayCategory
}

export function resolveActiveResultCategory(
  items: ScanItem[],
  userSelectedCategory: CleanupDisplayCategory | null,
  options?: { agentReviewing?: boolean }
): CleanupDisplayCategory {
  if (userSelectedCategory !== null) {
    return userSelectedCategory
  }
  return firstDisplayCategoryWithItems(items, options)
}

export class ResultCategoryViewState {
  private userSelectedCategory: CleanupDisplayCategory | null = null

  clear(): void {
    this.userSelectedCategory = null
  }

  select(category: CleanupDisplayCategory): void {
    this.userSelectedCategory = category
  }

  getUserSelectedCategory(): CleanupDisplayCategory | null {
    return this.userSelectedCategory
  }

  hasUserSelection(): boolean {
    return this.userSelectedCategory !== null
  }

  resolveActiveCategory(
    items: ScanItem[],
    options?: { agentReviewing?: boolean }
  ): CleanupDisplayCategory {
    return resolveActiveResultCategory(items, this.userSelectedCategory, options)
  }
}
