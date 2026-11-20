const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const DAY_MS = 86_400_000

export function scheduleOf(cron: string): string {
  const [minute, hour, day, month, weekday] = cron.trim().split(/\s+/)
  const every = /^\*\/(\d+)$/
  if (every.test(minute) && hour === '*' && day === '*' && month === '*' && weekday === '*') return `Every ${Number(every.exec(minute)?.[1])} minutes`
  if (minute === '0' && every.test(hour) && day === '*' && month === '*' && weekday === '*') return `Every ${Number(every.exec(hour)?.[1])} hours`
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || month !== '*') return 'Repeats'
  const time = `${Number(hour)}:${minute.padStart(2, '0')}`
  if (day === '*' && weekday === '*') return `Every day at ${time}`
  if (day === '*' && weekday === '1-5') return `Weekdays at ${time}`
  if (day === '*' && /^[0-6]$/.test(weekday)) return `${DAYS[Number(weekday)]} at ${time}`
  if (/^\d+$/.test(day) && weekday === '*') return `Monthly on the ${ordinal(Number(day))} at ${time}`
  return 'Repeats'
}

export function timeOf(at: Date): string {
  return `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`
}

export function dayOf({ at, now }: { at: Date; now: Date }): string {
  const days = Math.round((startOf(at) - startOf(now)) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days > 1 && days < 7) return at.toLocaleDateString('en-US', { weekday: 'long' })
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function nextOf({ at, now }: { at: Date; now: Date }): string {
  return `${dayOf({ at, now })} at ${timeOf(at)}`
}

export function dateOf(at: Date): string {
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function onceOf(at: Date): string {
  return `${at.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${timeOf(at)}`
}

function startOf(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${tail}`
}
