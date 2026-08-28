// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ScanItem } from '../src/shared/types'
import { normalizeCandidate } from '../src/shared/candidate-model'
import { patchResultCategoriesDom } from '../src/renderer/result-category-patch'

function item(id: string, ruleName: string, reason: string): ScanItem {
  return normalizeCandidate({
    id,
    ruleId: 'rule',
    ruleName,
    category: 'safe',
    name: id,
    path: `C:\\${id}`,
    size: 100,
    drive: 'C:',
    contentType: 'system-temp',
    reason,
    deletable: true,
    autoSelect: false,
    source: 'rule',
    snapshotComplete: true,
    entryKind: 'file',
    discoverySources: ['rule'],
    evidence: [],
    judgment: {
      status: 'suggested',
      source: 'legacy-rule',
      confidence: 'high',
      basis: [],
      judgmentOrigin: 'local-rule'
    },
    selection: { selectable: true },
    suggestedAction: 'trash'
  })
}

function buildPanel(ruleName: string, rendered: ScanItem): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'result-panel'
  panel.innerHTML = `
    <nav class="category-tabs">
      <button class="category-tab active" data-category="recommended-clean">
        <span class="category-tab-meta">1 项</span>
      </button>
    </nav>
    <div class="category-panels">
      <section class="category-panel active" id="cat-panel-recommended-clean">
        <section class="rule-group" data-rule-name="${ruleName}">
          <ul class="item-list">
            <li class="item" data-item-id="${rendered.id}" data-render-revision="old"></li>
          </ul>
        </section>
      </section>
    </div>
  `
  return panel
}

describe('result category patch revisions', () => {
  it('replaces existing row when agent updates reason but category structure is unchanged', () => {
    const panel = buildPanel('Temp', item('a', 'Temp', 'old reason'))
    const updated = item('a', 'Temp', 'agent reviewed reason')
    const patched = patchResultCategoriesDom(panel, [updated], {
      agentReviewing: false,
      formatSize: (bytes) => `${bytes} B`,
      createListItem: (entry) => {
        const li = document.createElement('li')
        li.className = 'item'
        li.dataset.itemId = entry.id
        li.textContent = entry.reason ?? ''
        return li
      }
    })
    expect(patched).toBe(true)
    expect(panel.querySelectorAll('[data-item-id="a"]').length).toBe(1)
    expect(panel.querySelector('[data-item-id="a"]')?.textContent).toContain('agent reviewed')
  })
})
