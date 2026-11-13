import type { SeatWindow } from '@fastmonkey/common/admin/admin.ts'
import { HttpError } from '../platform/http-error.ts'

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const CACHE_MS = 5 * 60_000
const TIMEOUT_MS = 15_000
const WINDOWS = [{ kind: 'five_hour', header: '5h' }, { kind: 'seven_day', header: '7d' }] as const
let cached: { token: string; at: number; windows: SeatWindow[] } | undefined

export const seatLimits = {
  async read(token: string): Promise<SeatWindow[]> {
    if (cached?.token === token && Date.now() - cached.at < CACHE_MS) return cached.windows
    const response = await fetch(MESSAGES_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined)
    if (!response) throw new HttpError(503, 'Claude didn\'t answer, so the seat\'s usage is unknown. Try again in a minute.')
    await response.body?.cancel()
    if (response.status === 401 || response.status === 403) throw new HttpError(409, 'Claude refused the seat token, so its usage is unknown. Replace the seat.')
    const windows = limitsFrom(response.headers)
    cached = { token, at: Date.now(), windows }
    return windows
  },
}

export function limitsFrom(headers: Headers): SeatWindow[] {
  return WINDOWS.flatMap(({ kind, header }) => {
    const used = headers.get(`anthropic-ratelimit-unified-${header}-utilization`)
    const reset = Number(headers.get(`anthropic-ratelimit-unified-${header}-reset`))
    if (used === null || !Number.isFinite(Number(used))) return []
    return [{ kind, percent: Math.round(Number(used) * 100), resetsAt: reset > 0 ? new Date(reset * 1000).toISOString() : null }]
  })
}
