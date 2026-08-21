let activeController: AbortController | null = null

export function beginScanSession(): AbortSignal {
  activeController?.abort()
  activeController = new AbortController()
  return activeController.signal
}

export function cancelScanSession(): void {
  activeController?.abort()
}

export function getScanSignal(): AbortSignal | undefined {
  return activeController?.signal
}

export function endScanSession(): void {
  activeController = null
}

export function isScanCancelled(): boolean {
  return activeController?.signal.aborted ?? false
}

export async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
