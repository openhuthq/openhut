export const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

export function ago(iso: string, now = Date.now()) {
  const seconds = Math.max(1, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  const days = Math.floor(seconds / 86400)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 30)}mo`
}
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

export function lastSeenOf({ at, now = new Date() }: { at: string; now?: Date }): string {
  const then = new Date(at)
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return ago(at, now.getTime())
  if (days === 1) return 'Yesterday'
  if (days < 7) return WEEKDAY.format(then)
  return DAY.format(then)
}
export const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function personName(email: string): string {
  const first = (email.split('@')[0] ?? '').split(/[._+-]/)[0] ?? ''
  return first.charAt(0).toUpperCase() + first.slice(1)
}

export function initialsOf({ name, count = 2 }: { name: string; count?: number }): string {
  const firsts = name.split(/[\s@._-]+/).flatMap((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? [])
  return firsts.slice(0, count).join('').toUpperCase() || '?'
}
