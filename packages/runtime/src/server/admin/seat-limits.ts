import type { SeatWindow } from '@openhut/common/admin/admin.ts'

const WINDOWS = [{ kind: 'five_hour', header: '5h' }, { kind: 'seven_day', header: '7d' }] as const
let seen: SeatWindow[] = []

export const seatLimits = {
  observe(headers: Headers): void {
    const windows = limitsFrom(headers)
    if (windows.length) seen = windows
  },
  latest: (): SeatWindow[] => seen,
}

export function limitsFrom(headers: Headers): SeatWindow[] {
  return WINDOWS.flatMap(({ kind, header }) => {
    const used = headers.get(`anthropic-ratelimit-unified-${header}-utilization`)
    const reset = Number(headers.get(`anthropic-ratelimit-unified-${header}-reset`))
    if (used === null || !Number.isFinite(Number(used))) return []
    return [{ kind, percent: Math.round(Number(used) * 100), resetsAt: reset > 0 ? new Date(reset * 1000).toISOString() : null }]
  })
}
