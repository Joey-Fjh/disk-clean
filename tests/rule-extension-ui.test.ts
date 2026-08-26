// @vitest-environment jsdom
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('rule extension user-facing copy', () => {
  it('does not expose internal draft terminology in renderer UI sources', () => {
    const files = [
      'src/renderer/index.html',
      'src/renderer/main.ts',
      'src/renderer/rule-draft-actions.ts',
      'src/renderer/rule-extension-mode.ts',
      'src/renderer/rule-knowledge-settings.ts'
    ]

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf-8')
      expect(source).not.toContain('规则草稿')
      expect(source).not.toContain('生成规则草稿')
      expect(source).not.toContain('导入草稿 JSON')
      expect(source).not.toContain('规则编写包')
    }
  })

  it('uses unified extension card markup', () => {
    const html = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf-8')
    expect(html).toContain('id="rule-extension-card"')
    expect(html).toContain('生成识别规则')
    expect(html).toContain('导出规则资料')
    expect(html).not.toContain('rule-extension-entry-wrap')
    expect(html).not.toContain('rule-draft-actions')
  })
})
