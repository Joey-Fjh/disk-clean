import { describe, expect, it } from 'vitest'
import { resolveInvestigationUiLabel } from '../src/renderer/investigation-status'

describe('investigation ui labels', () => {
  it('maps phases to minimal user-facing labels', () => {
    expect(resolveInvestigationUiLabel('tool_running')).toBe('正在调查')
    expect(resolveInvestigationUiLabel('cancelled')).toBe('已取消')
    expect(resolveInvestigationUiLabel('failed')).toBe('调查失败，本地结果仍可使用')
  })
})
