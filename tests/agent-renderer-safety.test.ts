// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildScanItemRenderInput } from '../src/renderer/candidate-render'
import { createScanItemElement } from '../src/renderer/safe-render'
import { normalizeCandidate } from '../src/shared/candidate-model'
import type { ScanItem } from '../src/shared/types'

describe('agent renderer safety', () => {
  it('renders agent text with textContent only', () => {
    const item = normalizeCandidate({
      id: 'a',
      ruleId: 'rule-a',
      ruleName: 'Temp',
      category: 'safe',
      contentType: 'system-temp',
      drive: 'C:',
      path: 'C:\\Temp\\x.tmp',
      size: 1,
      sizeIsEstimate: true,
      snapshotComplete: true,
      entryKind: 'file',
      deletable: true,
      autoSelect: true,
      source: 'rule',
      reason: 'temp',
      discoverySources: ['rule'],
      evidence: [],
      judgment: { status: 'suggested', source: 'agent', confidence: 'high', basis: ['x'] },
      agentInsight: {
        likelyContent: '<img src=x onerror=alert(1)>',
        reason: '<script>alert(1)</script>',
        impact: 'safe'
      },
      selection: { selectable: true },
      suggestedAction: 'recycle'
    } satisfies ScanItem)

    const li = createScanItemElement(
      buildScanItemRenderInput(item, { contentTypeLabel: '临时文件' })
    )
    expect(li.querySelector('.item-agent-insight')?.innerHTML).not.toContain('<img')
    expect(li.querySelector('.item-agent-insight')?.textContent).toContain('<img')
    expect(li.querySelector('script')).toBeNull()
  })
})
