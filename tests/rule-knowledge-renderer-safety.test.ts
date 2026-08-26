// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { loadRuleKnowledgeSettings } from '../src/renderer/rule-knowledge-settings'

function setupDom(): void {
  document.body.innerHTML = `
    <span id="rules-card-summary"></span>
    <div id="rule-packs-list"></div>
    <p id="rule-packs-status"></p>
    <div id="rule-drafts-list"></div>
    <div id="rule-draft-post-enable" hidden></div>
    <p id="rule-drafts-status"></p>
    <div id="safety-policy-list"></div>
  `
}

describe('rule knowledge settings renderer safety', () => {
  beforeEach(() => {
    setupDom()
    window.diskClean = {
      listRulePacks: vi.fn(async () => [
        {
          schemaVersion: '1',
          id: 'official-system',
          name: '系统规则包',
          version: '1.0.0',
          origin: 'official',
          platform: 'windows',
          description: '系统临时与缓存清理',
          enabled: true,
          ruleCount: 1,
          rules: [
            {
              id: 'user-temp',
              name: '用户临时文件',
              category: 'safe',
              contentType: 'system-temp',
              paths: ['%TEMP%', '%LOCALAPPDATA%\\Temp'],
              defaultChecked: true,
              reason: '应用和系统产生的临时文件',
              impact: '部分程序可能需重新生成临时数据',
              rebuildable: true,
              cleanupStrategy: 'trash'
            }
          ]
        }
      ]),
      listRuleDrafts: vi.fn(async () => []),
      getSafetyPolicy: vi.fn(async () => ({
        protectedPaths: [],
        protectedLabels: {},
        constraints: []
      }))
    } as unknown as typeof window.diskClean
  })

  it('does not render user-controlled draft fields via innerHTML', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/rule-knowledge-settings.ts'), 'utf-8')
    expect(source).not.toMatch(/innerHTML\s*=\s*`[^`]*\$\{/)
    expect(source).not.toMatch(/innerHTML\s*=\s*['"][^'"]*\+/)
  })

  it('renders expandable rule pack summaries without absolute paths', async () => {
    await loadRuleKnowledgeSettings()
    const details = document.querySelector<HTMLDetailsElement>('.rule-pack-details')
    expect(details).not.toBeNull()
    details!.open = true
    const text = document.getElementById('rule-packs-list')?.textContent ?? ''
    expect(text).toContain('用户临时文件')
    expect(text).toContain('%TEMP%')
    expect(text).not.toMatch(/[A-Z]:\\Users\\/)
  })
})
