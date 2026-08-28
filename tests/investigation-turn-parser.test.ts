import { describe, expect, it } from 'vitest'
import { parseModelTurn, parseNativeToolCalls } from '../src/main/agent/investigation/investigation-turn-parser'

const finalPayload = {
  schemaVersion: '1',
  summary: { headline: '建议', overview: '概述' },
  recommendations: [
    {
      candidateRef: 'candidate-1',
      verdict: 'clean',
      likelyContent: '缓存',
      reason: '可清理',
      impact: '小',
      confidence: 'high',
      basis: ['临时']
    }
  ]
}

describe('investigation turn parser', () => {
  it('accepts legacy final AgentModelResponse v1', () => {
    const parsed = parseModelTurn(JSON.stringify(finalPayload))
    expect(parsed.kind).toBe('legacy-final')
    if (parsed.kind === 'legacy-final') {
      expect(parsed.parsed.summary.headline).toBe('建议')
    }
  })

  it('accepts explicit final turn', () => {
    const parsed = parseModelTurn(
      JSON.stringify({
        schemaVersion: 1,
        action: 'final',
        result: finalPayload
      })
    )
    expect(parsed.kind).toBe('final')
  })

  it('accepts investigate turn with summarize_directory', () => {
    const parsed = parseModelTurn(
      JSON.stringify({
        schemaVersion: 1,
        action: 'investigate',
        purpose: '确认目录构成',
        calls: [{ candidateRef: 'candidate-2', tool: 'summarize_directory', relativePath: '.', depth: 1 }]
      })
    )
    expect(parsed.kind).toBe('investigate')
    if (parsed.kind === 'investigate') {
      expect(parsed.turn.calls[0]?.candidateRef).toBe('candidate-2')
    }
  })

  it('rejects absolute paths and sessionId injection', () => {
    expect(() =>
      parseModelTurn(
        JSON.stringify({
          schemaVersion: 1,
          action: 'investigate',
          purpose: 'test',
          sessionId: 'evil',
          calls: [{ candidateRef: 'candidate-1', tool: 'list_children' }]
        })
      )
    ).toThrow('RESPONSE_INVALID')

    expect(() =>
      parseModelTurn(
        JSON.stringify({
          schemaVersion: 1,
          action: 'investigate',
          purpose: 'test',
          calls: [{ candidateRef: 'candidate-1', tool: 'list_children', relativePath: 'C:\\Windows' }]
        })
      )
    ).toThrow('RESPONSE_INVALID')
  })

  it('rejects illegal tool names at parse time', () => {
    expect(() =>
      parseModelTurn(
        JSON.stringify({
          schemaVersion: 1,
          action: 'investigate',
          purpose: 'test',
          calls: [{ candidateRef: 'candidate-1', tool: 'delete_everything' }]
        })
      )
    ).toThrow('RESPONSE_INVALID')
  })

  it('rejects native tool_calls with too many calls', () => {
    const calls = Array.from({ length: 5 }, () => ({
      function: {
        name: 'list_children',
        arguments: JSON.stringify({ candidateRef: 'candidate-1' })
      }
    }))
    expect(() => parseNativeToolCalls(calls, '')).toThrow('RESPONSE_INVALID')
  })

  it('rejects native tool_calls with mixed valid and invalid calls', () => {
    expect(() =>
      parseNativeToolCalls(
        [
          {
            function: {
              name: 'list_children',
              arguments: JSON.stringify({ candidateRef: 'candidate-1' })
            }
          },
          {
            function: {
              name: 'list_children',
              arguments: JSON.stringify({ candidateRef: 'candidate-1', sessionId: 'evil' })
            }
          }
        ],
        ''
      )
    ).toThrow('RESPONSE_INVALID')
  })

  it('rejects native tool_calls with unknown argument fields', () => {
    expect(() =>
      parseNativeToolCalls(
        [
          {
            function: {
              name: 'list_children',
              arguments: JSON.stringify({ candidateRef: 'candidate-1', evil: true })
            }
          }
        ],
        ''
      )
    ).toThrow('RESPONSE_INVALID')
  })

  it('parses native tool_calls as investigate turn', () => {
    const parsed = parseNativeToolCalls(
      [
        {
          function: {
            name: 'summarize_directory',
            arguments: JSON.stringify({ candidateRef: 'candidate-3', depth: 1 })
          }
        }
      ],
      ''
    )
    expect(parsed.kind).toBe('investigate')
    if (parsed.kind === 'investigate') {
      expect(parsed.turn.calls[0]?.candidateRef).toBe('candidate-3')
    }
  })
})
