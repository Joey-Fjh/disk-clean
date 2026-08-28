import type { RuleConfig, RulesBundle } from '../../shared/types'
import type { CoreSafetyPolicy, DetectionHeuristic, RulePackManifest } from '../../shared/rule-layer-types'
import { RULE_PACK_SCHEMA_VERSION } from '../../shared/rule-layer-types'
import { sanitizeRuleForLoad } from '../../shared/rule-enforcement'
import { DEFAULT_PATH_ACCESS_POLICY, type PathAccessPolicy } from '../../shared/path-access-policy'
import { getConfigDir } from './config-dir'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { expandEnvVars } from '../../shared/path-utils'

const OFFICIAL_PACK_NAMES: Record<string, { id: string; name: string; description: string }> = {
  'system.json': { id: 'official-system', name: '系统规则包', description: '系统临时与缓存清理' },
  'browsers.json': { id: 'official-browsers', name: '浏览器规则包', description: '浏览器缓存与数据' },
  'developer.json': { id: 'official-developer', name: '开发工具规则包', description: '开发工具缓存与构建产物' },
  'agents.json': { id: 'official-agents', name: 'AI 工具规则包', description: 'AI 工具与应用缓存' },
  'apps.json': { id: 'official-apps', name: '应用规则包', description: '常见桌面应用缓存' }
}

let safetyCache: CoreSafetyPolicy | null = null
let heuristicCache: DetectionHeuristic[] | null = null
let officialPackCache: RulePackManifest[] | null = null
let legacyBundleCache: RulesBundle | null = null
let pathAccessPolicyCache: PathAccessPolicy | null = null

export function sanitizeRulesForLoad(rules: RuleConfig[]): RuleConfig[] {
  return rules.map((rule) => sanitizeRuleForLoad(rule))
}

function parsePolicyStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((item) => typeof item === 'string' && item.trim().length > 0)) return null
  return value.map((item) => item.trim())
}

export function loadPathAccessPolicy(): PathAccessPolicy {
  if (pathAccessPolicyCache) return pathAccessPolicyCache
  const path = join(getConfigDir(), 'safety', 'path-access-policy.json')
  if (!existsSync(path)) {
    pathAccessPolicyCache = DEFAULT_PATH_ACCESS_POLICY
    return pathAccessPolicyCache
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const denyRead = parsePolicyStringArray(parsed.denyRead)
    const readOnlyHighRisk = parsePolicyStringArray(parsed.readOnlyHighRisk)
    const denyDelete = parsePolicyStringArray(parsed.denyDelete)
    if (!denyRead || !readOnlyHighRisk || !denyDelete) {
      pathAccessPolicyCache = DEFAULT_PATH_ACCESS_POLICY
      return pathAccessPolicyCache
    }
    pathAccessPolicyCache = { denyRead, readOnlyHighRisk, denyDelete }
  } catch {
    pathAccessPolicyCache = DEFAULT_PATH_ACCESS_POLICY
  }
  return pathAccessPolicyCache
}

function loadProtectedPathsFile(path: string): { paths: string[]; labels: Record<string, string> } {
  if (!existsSync(path)) return { paths: [], labels: {} }
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

export function loadCoreSafetyPolicy(): CoreSafetyPolicy {
  if (safetyCache) return safetyCache
  const layered = join(getConfigDir(), 'safety', 'protected-paths.json')
  const legacy = join(getConfigDir(), 'protected-paths.json')
  const { paths, labels } = existsSync(layered)
    ? loadProtectedPathsFile(layered)
    : loadProtectedPathsFile(legacy)

  safetyCache = {
    protectedPaths: paths,
    protectedLabels: labels,
    constraints: [
      '禁止删除受保护系统目录',
      '禁止盘符根目录清理',
      '禁止路径穿越与符号链接越界',
      '禁止命令、脚本或任意执行',
      '清理优先进入回收站',
      '所有删除须经 SafetyValidator 校验'
    ],
    pathAccessPolicy: loadPathAccessPolicy()
  }
  return safetyCache
}

export function loadDetectionHeuristics(): DetectionHeuristic[] {
  if (heuristicCache) return heuristicCache
  const path = join(getConfigDir(), 'heuristics', 'generic.json')
  if (!existsSync(path)) {
    heuristicCache = []
    return heuristicCache
  }
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { heuristics?: DetectionHeuristic[] }
  heuristicCache = Array.isArray(parsed.heuristics) ? parsed.heuristics : []
  return heuristicCache
}

function loadRulesFromDir(dir: string): RuleConfig[] {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const rules: RuleConfig[] = []
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8')
    const parsed = JSON.parse(raw) as { rules?: RuleConfig[] }
    if (Array.isArray(parsed.rules)) rules.push(...sanitizeRulesForLoad(parsed.rules))
  }
  return rules
}

export function loadOfficialPacksFromDir(dir: string): RulePackManifest[] {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const packs: RulePackManifest[] = []
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8')
    const parsed = JSON.parse(raw) as { rules?: RuleConfig[]; schemaVersion?: string; id?: string }
    if (parsed.schemaVersion === RULE_PACK_SCHEMA_VERSION && parsed.id && Array.isArray(parsed.rules)) {
      packs.push({
        ...parsed,
        rules: sanitizeRulesForLoad(parsed.rules)
      } as RulePackManifest)
      continue
    }
    const meta = OFFICIAL_PACK_NAMES[file] ?? {
      id: `official-${file.replace(/\.json$/, '')}`,
      name: file,
      description: '官方规则包'
    }
    packs.push({
      schemaVersion: RULE_PACK_SCHEMA_VERSION,
      id: meta.id,
      name: meta.name,
      version: '1.0.0',
      origin: 'official',
      platform: 'windows',
      description: meta.description,
      rules: sanitizeRulesForLoad(parsed.rules ?? [])
    })
  }
  return packs
}

export function loadOfficialRulePacks(): RulePackManifest[] {
  if (officialPackCache) return officialPackCache
  const layered = join(getConfigDir(), 'rule-packs', 'official')
  const legacy = join(getConfigDir(), 'rules')
  const packs = loadOfficialPacksFromDir(layered)
  officialPackCache = packs.length > 0 ? packs : wrapLegacyRulesAsPacks(loadRulesFromDir(legacy))
  return officialPackCache
}

function wrapLegacyRulesAsPacks(rules: RuleConfig[]): RulePackManifest[] {
  if (rules.length === 0) return []
  return [
    {
      schemaVersion: RULE_PACK_SCHEMA_VERSION,
      id: 'official-legacy-bundle',
      name: '官方规则包（兼容）',
      version: '1.0.0',
      origin: 'official',
      platform: 'windows',
      description: '从旧版 rules 目录加载',
      rules
    }
  ]
}

/** 兼容旧版 RulesBundle：仅包含官方规则包规则，不含 protected paths。 */
export function loadRulesBundle(): RulesBundle {
  if (legacyBundleCache) return legacyBundleCache
  const safety = loadCoreSafetyPolicy()
  const rules = loadOfficialRulePacks().flatMap((pack) => pack.rules)
  legacyBundleCache = {
    protectedPaths: safety.protectedPaths,
    protectedLabels: safety.protectedLabels,
    rules
  }
  return legacyBundleCache
}

export function clearRulesLayerCache(): void {
  safetyCache = null
  heuristicCache = null
  officialPackCache = null
  legacyBundleCache = null
  pathAccessPolicyCache = null
}

/** @deprecated 使用 clearRulesLayerCache */
export function clearRulesCache(): void {
  clearRulesLayerCache()
}

export function getRuleById(ruleId: string): RuleConfig | undefined {
  return loadRulesBundle().rules.find((rule) => rule.id === ruleId)
}
