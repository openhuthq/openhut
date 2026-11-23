export const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
export const shortDateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function ago(iso: string) {
  const seconds = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}
export const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
