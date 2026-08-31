import type { ScanItem } from '../../shared/types'
import { normalizeCandidate } from '../../shared/candidate-model'
import { normalizePath } from '../../shared/path-utils'
import type { UserExperienceEntry } from '../../shared/user-experience-types'

function normalizeToken(input: string): string {
  return input.replace(/\//g, '\\').toLowerCase()
}

function pathMatchesSuffix(path: string, suffix: string): boolean {
  const normalized = normalizePath(path)
  const token = normalizeToken(suffix)
  if (!token) return false
  return normalized.includes(token)
}

export function matchesUserExperience(item: ScanItem, entry: UserExperienceEntry): boolean {
  const matcher = entry.matcher
  if (matcher.ruleId && item.ruleId !== matcher.ruleId) return false
  if (matcher.contentType && item.contentType !== matcher.contentType) return false
  if (matcher.softwareName) {
    const name = matcher.softwareName.toLowerCase()
    const haystack = `${item.ruleName} ${item.reason}`.toLowerCase()
    if (!haystack.includes(name)) return false
  }
  if (matcher.relativePathSuffix && !pathMatchesSuffix(item.path, matcher.relativePathSuffix)) {
    return false
  }
  return true
}

export function enrichItemsWithUserExperiences(
  items: ScanItem[],
  entries: UserExperienceEntry[]
): ScanItem[] {
  const active = entries.filter((entry) => entry.enabled)
  if (active.length === 0) return items

  return items.map((item) => {
    const normalized = normalizeCandidate(item)
    const keepEntries = active.filter(
      (entry) => entry.kind === 'keep-exclusion' && matchesUserExperience(normalized, entry)
    )
    const hintEntries = active.filter(
      (entry) => entry.kind === 'recognition-hint' && matchesUserExperience(normalized, entry)
    )

    let next = normalized
    if (hintEntries.length > 0) {
      const evidence = [...next.evidence]
      for (const entry of hintEntries) {
        evidence.push({
          source: 'local-feature',
          summary: entry.reason,
          ruleName: entry.name
        })
      }
      next = {
        ...next,
        evidence,
        deletable: next.deletable,
        judgment: next.judgment,
        selection: next.selection
      }
    }

    if (keepEntries.length > 0) {
      const reason = keepEntries.map((entry) => entry.reason).join('；')
      next = normalizeCandidate({
        ...next,
        judgment: {
          status: 'keep',
          judgmentOrigin: 'local-rule',
          source: 'legacy-rule',
          confidence: 'high',
          basis: [reason]
        },
        deletable: false,
        autoSelect: false,
        selection: {
          selectable: false,
          notSelectableReason: '已按您的经验设置为保留'
        }
      })
    }

    return next
  })
}
