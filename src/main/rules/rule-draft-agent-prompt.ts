import { AGENT_LIMITS } from '../../shared/agent-limits'
import { RULE_DRAFT_SCHEMA_VERSION } from '../../shared/rule-layer-types'
import type { ScanItem } from '../../shared/types'
import { buildAgentPromptPayload } from '../agent/agent-prompt'
import type { SanitizePathOptions } from '../agent/path-sanitize'

const SYSTEM_PROMPT = `你是 Disk Clean 的规则草稿助手。你只能根据提供的脱敏扫描摘要生成 RuleDraft v1 草稿。

安全规则（必须遵守）：
1. 只能输出严格 JSON，不要使用 Markdown 代码块。
2. 不得输出绝对路径、删除命令、shell 命令或可执行字段。
3. 禁止字段：deletable、defaultChecked、nativeManaged、cleanupStrategy、command、exec、script、shell。
4. basePlaceholders 只能使用：%TEMP%、%LOCALAPPDATA%、%APPDATA%、%USERPROFILE%、%SystemRoot%、%ProgramData%。
5. 必须且只能提供 relativePatterns、subdirs、globDirs 三者之一（不可混用），且只能是相对片段。
6. subdirs 只能是纯字面相对路径；globDirs 仅允许字面目录锚点加受控通配，禁止 brace/extglob/字符组。
7. suggestedRisk 只能是 safe、recommended、dangerous；不得将用户数据风险降为 safe。
8. 不得扩大到输入证据以外的范围。

输出 schemaVersion 必须为 "1"。`

export interface RuleDraftPromptBuild {
  messages: Array<{ role: 'system' | 'user'; content: string }>
  refToId: Map<string, string> & { hasValue?: (id: string) => boolean }
  requestBytes: number
}

export function buildRuleDraftMessages(
  items: ScanItem[],
  options: SanitizePathOptions = {}
): RuleDraftPromptBuild {
  const build = buildAgentPromptPayload(items, options)
  const refToId = build.refToId

  const payload = {
    schemaVersion: RULE_DRAFT_SCHEMA_VERSION,
    instruction: '根据候选项生成一条可复用的 RuleDraft v1 草稿，用于未来识别同类内容。',
    candidates: build.payload.candidates
  }

  const userContent = JSON.stringify(payload)
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userContent }
  ]

  const requestBytes = Buffer.byteLength(JSON.stringify(messages), 'utf-8')
  if (requestBytes > AGENT_LIMITS.MAX_REQUEST_BYTES) {
    return { messages, refToId, requestBytes }
  }

  const extendedRefMap = refToId as Map<string, string> & { hasValue: (id: string) => boolean }
  extendedRefMap.hasValue = (id: string) => [...refToId.values()].includes(id)

  return { messages, refToId: extendedRefMap, requestBytes }
}
