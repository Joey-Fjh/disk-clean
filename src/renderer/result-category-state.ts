import type { Category, ScanItem } from '../shared/types'
import { CATEGORY_ORDER } from '../shared/types'

export function groupItemsByCategory(items: ScanItem[]): Record<Category, ScanItem[]> {
  return Object.fromEntries(
    CATEGORY_ORDER.map((cat) => [cat, items.filter((item) => item.category === cat)])
  ) as Record<Category, ScanItem[]>
}

export function firstCategoryWithItems(items: ScanItem[]): Category {
  const grouped = groupItemsByCategory(items)
  return CATEGORY_ORDER.find((cat) => grouped[cat].length > 0) ?? 'safe'
}

/** 决定本次重绘应激活的结果分类 Tab。 */
export function resolveActiveResultCategory(
  items: ScanItem[],
  userSelectedCategory: Category | null
): Category {
  if (userSelectedCategory !== null) {
    return userSelectedCategory
  }
  return firstCategoryWithItems(items)
}

export class ResultCategoryViewState {
  private userSelectedCategory: Category | null = null

  clear(): void {
    this.userSelectedCategory = null
  }

  select(category: Category): void {
    this.userSelectedCategory = category
  }

  getUserSelectedCategory(): Category | null {
    return this.userSelectedCategory
  }

  hasUserSelection(): boolean {
    return this.userSelectedCategory !== null
  }

  resolveActiveCategory(items: ScanItem[]): Category {
    return resolveActiveResultCategory(items, this.userSelectedCategory)
  }
}
