import type { QueryClient, QueryFilters } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { LIVE_BEAT_MS, LiveEvent } from '@openhut/common/live.ts'
import { openChannel, type Channel } from '@/lib/live-socket'
import { storedComputers } from '@/lib/openhut'
import { AGENTS_KEY, COMPUTERS_KEY, CONNECTIONS_KEY, GRANTS_KEY, PROVIDERS_KEY, THREADS_KEY } from '@/lib/query-keys'

const FILTERS: Record<string, QueryFilters[]> = {
  agent: [{ queryKey: AGENTS_KEY }],
  thread: [{ queryKey: THREADS_KEY, exact: true }, { queryKey: [...THREADS_KEY, 'agent'] }],
  channel: [{ queryKey: ['channels'] }],
  connection: [{ queryKey: CONNECTIONS_KEY }],
  grant: [{ queryKey: GRANTS_KEY }],
  skill: [{ queryKey: ['skills'] }, { queryKey: ['skill'] }],
  memory: [{ queryKey: ['memory'] }],
  routine: [{ queryKey: ['routines'] }],
  provider: [{ queryKey: PROVIDERS_KEY }],
  admin: [{ queryKey: COMPUTERS_KEY }],
}
const EVERYTHING = Object.values(FILTERS).flat()
const OFFLINE = [{ queryKey: COMPUTERS_KEY }, { queryKey: AGENTS_KEY }]
const GIVE_UP = [4401, 4403, 4404]
const SILENT_MS = LIVE_BEAT_MS * 2.5
const CHECK_MS = 10_000
const SYNC_MS = 30_000
const FLUSH_MS = 250
const FIRST_WAIT_MS = 1000
const MAX_WAIT_MS = 30_000
const MAX_WAIT_UNHEARD_MS = 300_000

type Follow = { channel?: Channel; retry?: ReturnType<typeof setTimeout>; heardAt: number; heard: boolean; live: boolean; tries: number }

export function followComputers(client: QueryClient): void {
  const follows = new Map<string, Follow>()
  const pending = new Map<string, QueryFilters>()
  let flush: ReturnType<typeof setTimeout> | undefined

  const invalidate = (filters: QueryFilters[]) => {
    for (const filter of filters) pending.set(JSON.stringify(filter), filter)
    flush ??= setTimeout(() => {
      flush = undefined
      const due = [...pending.values()]
      pending.clear()
      for (const filter of due) void client.invalidateQueries(filter)
    }, FLUSH_MS)
  }

  const open = (computer: string, follow: Follow) => {
    clearTimeout(follow.retry)
    follow.retry = undefined
    follow.heardAt = Date.now()
    const channel: Channel = openChannel({
      computer,
      path: '/api/events',
      onLine: (line) => {
        follow.heardAt = Date.now()
        const event = z.safeParse(LiveEvent, parsed(line)).data
        if (!event) return
        if (event.type === 'beat') return channel.send('beat')
        if (event.type !== 'hello') return invalidate(FILTERS[event.data.object] ?? [])
        if (follow.heard) invalidate(EVERYTHING)
        follow.heard = true
        follow.live = true
        follow.tries = 0
      },
      onClose: (code) => {
        if (follow.channel === channel) drop({ computer, follow, code })
      },
    })
    follow.channel = channel
  }

  const drop = ({ computer, follow, code }: { computer: string; follow: Follow; code: number }) => {
    follow.channel = undefined
    if (follow.live) invalidate(OFFLINE)
    follow.live = false
    if (GIVE_UP.includes(code) || !follows.has(computer)) return
    follow.tries += 1
    const wait = Math.min(follow.heard ? MAX_WAIT_MS : MAX_WAIT_UNHEARD_MS, FIRST_WAIT_MS * 2 ** follow.tries)
    follow.retry = setTimeout(() => open(computer, follow), Math.random() * wait)
  }

  const sync = async () => {
    const ids = new Set((await storedComputers()).map((computer) => computer.id))
    for (const [computer, follow] of follows) {
      if (ids.has(computer)) continue
      follows.delete(computer)
      clearTimeout(follow.retry)
      follow.channel?.close()
    }
    for (const computer of ids) {
      if (follows.has(computer)) continue
      const follow: Follow = { heardAt: 0, heard: false, live: false, tries: 0 }
      follows.set(computer, follow)
      open(computer, follow)
    }
  }

  const check = () => {
    for (const [computer, follow] of follows) {
      if (follow.channel && Date.now() - follow.heardAt > SILENT_MS) {
        follow.channel.close()
        drop({ computer, follow, code: 1006 })
      }
    }
  }

  const wake = () => {
    if (document.visibilityState !== 'visible') return
    check()
    for (const [computer, follow] of follows) if (!follow.channel && follow.retry && follow.heard) open(computer, follow)
  }

  void sync().catch(() => undefined)
  setInterval(() => void sync().catch(() => undefined), SYNC_MS)
  setInterval(check, CHECK_MS)
  document.addEventListener('visibilitychange', wake)
}

function parsed(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}
