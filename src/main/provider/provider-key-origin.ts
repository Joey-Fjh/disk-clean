import { ProviderError } from './provider-errors'
import { providerOriginFromBaseUrl } from './provider-url'

/** 从已存配置推导 Key 绑定的 Origin；无 keyOrigin 时回退到 baseUrl。无法安全解析时抛出 KEY_REENTRY_REQUIRED。 */
export function deriveStoredKeyOrigin(baseUrl: string, keyOrigin?: string): string {
  if (keyOrigin) {
    return keyOrigin
  }
  try {
    return providerOriginFromBaseUrl(baseUrl)
  } catch {
    throw new ProviderError(
      'KEY_REENTRY_REQUIRED',
      '无法验证已保存 Key 的服务地址，请重新输入 API Key'
    )
  }
}

export function assertKeyOriginCompatible(
  boundOrigin: string,
  newOrigin: string
): void {
  if (boundOrigin !== newOrigin) {
    throw new ProviderError(
      'KEY_REENTRY_REQUIRED',
      '服务地址已变更，请重新输入 API Key 后再保存'
    )
  }
}
