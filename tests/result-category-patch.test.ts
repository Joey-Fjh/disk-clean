// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ScanItem } from '../src/shared/types'
import { normalizeCandidate } from '../src/shared/candidate-model'
import {
  buildResultStructureKey,
  patchResultCategoriesDom
} from '../src/renderer/result-category-patch'

function item(id: string, ruleName: string): ScanItem {
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
    reason: '',
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

function buildMinimalPanel(ruleName: string, renderedId: string): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'result-panel'
  panel.innerHTML = `
    <nav class="category-tabs">
      <button class="category-tab active" data-category="recommended-clean">
        <span class="category-tab-label">推荐清理</span>
        <span class="category-tab-meta">0 项</span>
      </button>
    </nav>
    <div class="category-panels">
      <section class="category-panel active" id="cat-panel-recommended-clean">
        <div class="rule-groups">
          <section class="rule-group is-expanded" data-rule-name="${ruleName}">
            <button class="rule-group-header">
              <span class="rule-group-name"></span>
              <span class="rule-group-meta"></span>
            </button>
            <div class="rule-group-body">
              <ul class="item-list">
                <li class="item" data-item-id="${renderedId}"></li>
              </ul>
            </div>
          </section>
        </div>
      </section>
    </div>
  `
  return panel
}

describe('result category patch', () => {
  it('builds stable structure keys for unchanged rule layout', () => {
    const first = buildResultStructureKey([item('a', 'Temp')], { agentReviewing: false })
    const second = buildResultStructureKey([item('b', 'Temp'), item('c', 'Temp')], {
      agentReviewing: false
    })
    expect(first).toBe(second)
  })

  it('appends only missing items when structure is unchanged', () => {
    const panel = buildMinimalPanel('Temp', 'a')
    const patched = patchResultCategoriesDom(panel, [item('a', 'Temp'), item('b', 'Temp')], {
      agentReviewing: false,
      formatSize: (bytes) => `${bytes} B`,
      createListItem: (entry) => {
        const li = document.createElement('li')
        li.className = 'item'
        li.dataset.itemId = entry.id
        return li
      }
    })
    expect(patched).toBe(true)
    expect(panel.querySelectorAll('[data-item-id]').length).toBe(2)
    const meta = panel.querySelector('.category-tab-meta')
    expect(meta?.textContent).toContain('2 项')
  })
})
