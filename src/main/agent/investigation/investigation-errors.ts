import type { AgentErrorCode } from '../../../shared/agent-errors'

export class InvestigationError extends Error {
  readonly code: AgentErrorCode

  constructor(code: AgentErrorCode, message: string) {
    super(message)
    this.name = 'InvestigationError'
    this.code = code
  }
}

export function investigationErrorMessage(code: AgentErrorCode): string {
  switch (code) {
    case 'SESSION_STALE':
      return '扫描会话已过期'
    case 'CANDIDATE_NOT_FOUND':
      return '候选引用无效'
    case 'INVALID_RELATIVE_PATH':
      return '相对路径无效'
    case 'PATH_OUTSIDE_CANDIDATE':
      return '目标路径超出候选范围'
    case 'PROTECTED_PATH':
      return '目标路径受保护'
    case 'REPARSE_POINT_BLOCKED':
      return '符号链接或联接点不允许'
    case 'TOOL_NOT_ALLOWED':
      return '调查工具不可用'
    case 'TOOL_LIMIT_EXCEEDED':
      return '调查预算已用尽，无法进一步确定'
    case 'RESPONSE_TOO_LARGE':
      return '调查结果过大'
    case 'TIMEOUT':
      return '调查超时'
    case 'CANCELLED':
      return '调查已取消'
    case 'IO_ERROR':
      return '无法读取磁盘数据'
    default:
      return '调查失败'
  }
}
