import { app } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { RuleConfig, RulesBundle } from '../../shared/types'
import { expandEnvVars } from '../../shared/path-utils'

let bundleCache: RulesBundle | null = null

function getConfigDir(): string {
  if (!app.isPackaged) {
    return join(process.cwd(), 'config')
  }
  return join(process.resourcesPath, 'config')
}

function loadProtectedPaths(): { paths: string[]; labels: Record<string, string> } {
  const path = join(getConfigDir(), 'protected-paths.json')
  if (!existsSync(path)) {
    const legacy = join(getConfigDir(), 'blacklist.json')
    if (existsSync(legacy)) {
      const parsed = JSON.parse(readFileSync(legacy, 'utf-8')) as { paths?: string[] }
      return {
        paths: (parsed.paths ?? []).map((entry) => expandEnvVars(entry)),
        labels: {}
      }
    }
    return { paths: [], labels: {} }
  }

  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
    paths?: string[]
    labels?: Record<string, string>
  }
  return {
    paths: (parsed.paths ?? []).map((entry) => expandEnvVars(entry)),
    labels: Object.fromEntries(
      Object.entries(parsed.labels ?? {}).map(([key, label]) => [expandEnvVars(key), label])
    )
  }
}

function loadRulesFromDir(): RuleConfig[] {
  const rulesDir = join(getConfigDir(), 'rules')
  if (!existsSync(rulesDir)) return []

  const files = readdirSync(rulesDir)
    .filter((name) => name.endsWith('.json'))
    .sort()

  const rules: RuleConfig[] = []
  for (const file of files) {
    const raw = readFileSync(join(rulesDir, file), 'utf-8')
    const parsed = JSON.parse(raw) as { rules?: RuleConfig[] }
    if (Array.isArray(parsed.rules)) {
      rules.push(...parsed.rules)
    }
  }
  return rules
}

function loadLegacyRulesFile(): RuleConfig[] {
  const path = join(getConfigDir(), 'rules.json')
  if (!existsSync(path)) return []
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { rules?: RuleConfig[] }
  return parsed.rules ?? []
}

export function loadRulesBundle(): RulesBundle {
  if (bundleCache) return bundleCache

  const fromDir = loadRulesFromDir()
  const rules = fromDir.length > 0 ? fromDir : loadLegacyRulesFile()
  const { paths, labels } = loadProtectedPaths()

  bundleCache = { protectedPaths: paths, protectedLabels: labels, rules }
  return bundleCache
}

export function clearRulesCache(): void {
  bundleCache = null
}

export function getRuleById(ruleId: string): RuleConfig | undefined {
  return loadRulesBundle().rules.find((rule) => rule.id === ruleId)
}
