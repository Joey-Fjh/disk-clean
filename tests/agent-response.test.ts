import { describe, expect, it } from 'vitest'
import { parseAgentModelResponse, filterRecommendationsByRefs } from '../src/main/agent/agent-response'

const validResponse = {
  schemaVersion: '1',
  summary: {
    headline: '可清理临时文件',
    overview: '发现少量可安全清理的缓存。'
  },
  recommendations: [
    {
      candidateRef: 'candidate-1',
      verdict: 'clean',
      likelyContent: '浏览器缓存',
      reason: '可再生的临时缓存',
      impact: '清理后应用会重建缓存',
      confidence: 'high',
      basis: ['临时目录', '可重建']
    }
  ]
}

describe('agent response validation', () => {
  it('parses valid schema v1 json', () => {
    const parsed = parseAgentModelResponse(JSON.stringify(validResponse))
    expect(parsed.summary.headline).toBe('可清理临时文件')
    expect(parsed.recommendations).toHaveLength(1)
  })

  it('rejects invalid schema version', () => {
    expect(() =>
      parseAgentModelResponse(JSON.stringify({ ...validResponse, schemaVersion: '2' }))
    ).toThrow('RESPONSE_INVALID')
  })

  it('ignores unknown and duplicate candidate refs', () => {
    const parsed = parseAgentModelResponse(
      JSON.stringify({
        ...validResponse,
        recommendations: [
          ...validResponse.recommendations,
          { ...validResponse.recommendations[0], candidateRef: 'candidate-999' },
          { ...validResponse.recommendations[0], candidateRef: 'candidate-1', reason: 'dup' }
        ]
      })
    )
    const filtered = filterRecommendationsByRefs(parsed.recommendations, new Set(['candidate-1']))
    expect(filtered.accepted).toHaveLength(1)
    expect(parsed.skippedInvalidCount + filtered.skippedInvalidCount).toBeGreaterThan(0)
  })

  it('keeps valid recommendations when some entries are invalid', () => {
    const parsed = parseAgentModelResponse(
      JSON.stringify({
        ...validResponse,
        recommendations: [
          validResponse.recommendations[0],
          { candidateRef: 'candidate-2', verdict: 'bad', likelyContent: 'x' }
        ]
      })
    )
    expect(parsed.recommendations).toHaveLength(1)
    expect(parsed.skippedInvalidCount).toBe(1)
  })

  it('parses fenced json without markdown execution', () => {
    const fenced = '```json\n' + JSON.stringify(validResponse) + '\n```'
    const parsed = parseAgentModelResponse(fenced)
    expect(parsed.recommendations[0]?.verdict).toBe('clean')
  })
})
