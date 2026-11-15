import type { Schedule } from '@openhut/common/automations/automation.ts'

const HOUR_MS = 3_600_000
const MONDAY = 1

export function nextRun({ schedule, after }: { schedule: Schedule; after: Date }): Date {
  const [hour, minute] = schedule.at.split(':').map(Number)
  if (schedule.every === 'hourly') {
    const next = new Date(after)
    next.setMinutes(minute, 0, 0)
    return next > after ? next : new Date(next.getTime() + HOUR_MS)
  }
  const week = Array.from({ length: 8 }, (_, day) => {
    const next = new Date(after)
    next.setDate(after.getDate() + day)
    next.setHours(hour, minute, 0, 0)
    return next
  })
  return week.find((next) => next > after && runsOn({ schedule, weekday: next.getDay() })) ?? week[7]
}

function runsOn({ schedule, weekday }: { schedule: Schedule; weekday: number }): boolean {
  if (schedule.every === 'weekdays') return weekday >= 1 && weekday <= 5
  if (schedule.every === 'weekly') return weekday === (schedule.day ?? MONDAY)
  return true
}
