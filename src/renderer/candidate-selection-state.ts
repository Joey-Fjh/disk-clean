export class CandidateSelectionViewState {
  private readonly selectedIds = new Set<string>()
  private selectionTouched = false

  clear(): void {
    this.selectedIds.clear()
    this.selectionTouched = false
  }

  select(id: string): void {
    this.selectedIds.add(id)
    this.selectionTouched = true
  }

  deselect(id: string): void {
    this.selectedIds.delete(id)
    this.selectionTouched = true
  }

  setMany(ids: string[], selected: boolean): void {
    for (const id of ids) {
      if (selected) this.selectedIds.add(id)
      else this.selectedIds.delete(id)
    }
    this.selectionTouched = true
  }

  hasUserInteraction(): boolean {
    return this.selectionTouched
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id)
  }

  getSelectedIds(): ReadonlySet<string> {
    return this.selectedIds
  }

  reconcileFinalItems<T extends { id: string }>(
    items: T[],
    getDefaultChecked: (item: T) => boolean
  ): void {
    const validIds = new Set(items.map((item) => item.id))
    for (const id of [...this.selectedIds]) {
      if (!validIds.has(id)) {
        this.selectedIds.delete(id)
      }
    }

    if (!this.selectionTouched) {
      this.selectedIds.clear()
      for (const item of items) {
        if (getDefaultChecked(item)) {
          this.selectedIds.add(item.id)
        }
      }
    }
  }

  reconcileAfterAgentUpdate<T extends { id: string }>(
    items: T[],
    isSelectable: (item: T) => boolean,
    getDefaultChecked: (item: T) => boolean
  ): void {
    const selectableIds = new Set(
      items.filter((item) => isSelectable(item)).map((item) => item.id)
    )
    for (const id of [...this.selectedIds]) {
      if (!selectableIds.has(id)) {
        this.selectedIds.delete(id)
      }
    }

    if (!this.selectionTouched) {
      this.selectedIds.clear()
      for (const item of items) {
        if (isSelectable(item) && getDefaultChecked(item)) {
          this.selectedIds.add(item.id)
        }
      }
    }
  }
}
