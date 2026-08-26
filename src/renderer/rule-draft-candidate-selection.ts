import { randomUUID } from 'crypto'

export class RuleDraftCandidateSelectionState {
  private readonly selectedIds = new Set<string>()

  clear(): void {
    this.selectedIds.clear()
  }

  select(id: string): void {
    this.selectedIds.add(id)
  }

  deselect(id: string): void {
    this.selectedIds.delete(id)
  }

  toggle(id: string, selected: boolean): void {
    if (selected) this.selectedIds.add(id)
    else this.selectedIds.delete(id)
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id)
  }

  getSelectedIds(): ReadonlySet<string> {
    return this.selectedIds
  }
}
