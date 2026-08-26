/** 统一的字节数格式化（1024 进制）。 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = bytes / Math.pow(1024, unitIndex)
  return `${value.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}
