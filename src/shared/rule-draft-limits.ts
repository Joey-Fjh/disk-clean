export const RULE_DRAFT_LIMITS = {
  MAX_CANDIDATES_PER_REQUEST: 8,
  MAX_DRAFTS: 100,
  MAX_NAME_LENGTH: 128,
  MAX_REASON_LENGTH: 512,
  MAX_IMPACT_LENGTH: 512,
  MAX_ARRAY_ITEMS: 16,
  MAX_DEPTH: 12,
  MAX_AGE_DAYS: 3650,
  MAX_BASE_PLACEHOLDERS: 4,
  MAX_REQUEST_BYTES: 64 * 1024,
  MAX_DRAFT_JSON_BYTES: 32 * 1024,
  MAX_PREVIEW_SAMPLES: 8,
  ANALYSIS_TIMEOUT_MS: 60_000,
  DRAFT_MAX_TOKENS: 2048
} as const

export const RULE_DRAFT_FORBIDDEN_FIELDS = [
  'deletable',
  'defaultChecked',
  'nativeManaged',
  'command',
  'exec',
  'script',
  'shell',
  'cmd',
  'powershell',
  'cleanupStrategy',
  'category',
  'paths',
  'authorization',
  'delete',
  'http',
  'https',
  'ftp'
] as const

export const RULE_DRAFT_ALLOWED_PLACEHOLDERS = new Set([
  '%TEMP%',
  '%LOCALAPPDATA%',
  '%APPDATA%',
  '%USERPROFILE%',
  '%SystemRoot%',
  '%ProgramData%'
])
