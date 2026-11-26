import type { QueryClient, QueryFilters } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { LIVE_BEAT_MS, LiveEvent } from '@openhut/common/live.ts'
import { openChannel, type Channel } from '@/lib/live-socket'
import { liveThreads, LiveSnapshot, ThreadEvent } from '@/lib/thread-live'
import { request } from '@/lib/api-client'
import { AGENTS_KEY, COMPUTERS_KEY, CONNECTIONS_KEY, GRANTS_KEY, PROVIDERS_KEY, THREADS_KEY } from '@/lib/query-keys'

const FILTERS: Record<string, QueryFilters[]> = {
  agent: [{ queryKey: AGENTS_KEY }],
  thread: [{ queryKey: THREADS_KEY, exact: true }, { queryKey: [...THREADS_KEY, 'thread'] }],
  channel: [{ queryKey: ['channels'] }],
  connection: [{ queryKey: CONNECTIONS_KEY }],
  grant: [{ queryKey: GRANTS_KEY }],
  skill: [{ queryKey: ['skills'] }, { queryKey: ['skill'] }],
  memory: [{ queryKey: ['memory'] }],
  routine: [{ queryKey: ['routines'] }],
  ask: [{ queryKey: ['asks'] }],
  provider: [{ queryKey: PROVIDERS_KEY }],
  admin: [{ queryKey: COMPUTERS_KEY }],
}
const OFFLINE = [{ queryKey: COMPUTERS_KEY }, { queryKey: AGENTS_KEY }]
const GIVE_UP = [4401, 4403, 4404]
const SILENT_MS = LIVE_BEAT_MS * 2.5
const CHECK_MS = 10_000
const FLUSH_MS = 250
const FIRST_WAIT_MS = 1000
const MAX_WAIT_MS = 30_000
const MAX_WAIT_UNHEARD_MS = 300_000

export function followEvents(client: QueryClient): void {
  const follow: { channel?: Channel; retry?: ReturnType<typeof setTimeout>; heardAt: number; heard: boolean; live: boolean; tries: number } = { heardAt: 0, heard: false, live: false, tries: 0 }
  const pending = new Map<string, QueryFilters>()
  let flush: ReturnType<typeof setTimeout> | undefined
  liveThreads.connect({
    send: (message) => follow.channel?.send(JSON.stringify(message)),
    fetchLive: (thread) => request({ schema: LiveSnapshot, path: `/api/threads/${encodeURIComponent(thread)}/live` }),
    refetch: (thread) => client.invalidateQueries({ queryKey: [...THREADS_KEY, 'thread', thread] }),
  })

  const invalidate = (filters: QueryFilters[]) => {
    for (const filter of filters) pending.set(JSON.stringify(filter), filter)
    flush ??= setTimeout(() => {
      flush = undefined
      const due = [...pending.values()]
      pending.clear()
      for (const filter of due) void client.invalidateQueries(filter)
    }, FLUSH_MS)
  }

  const open = () => {
    clearTimeout(follow.retry)
    follow.retry = undefined
    follow.heardAt = Date.now()
    const channel: Channel = openChannel({
      path: '/api/events',
      onLine: (line) => {
        follow.heardAt = Date.now()
        const message = parsed(line)
        const live = z.safeParse(ThreadEvent, message).data
        if (live) return liveThreads.receive(live)
        const event = z.safeParse(LiveEvent, message).data
        if (!event) return
        if (event.type === 'beat') return channel.send('beat')
        if (event.type !== 'hello') return invalidate(FILTERS[event.data.object] ?? [])
        if (follow.heard) void client.invalidateQueries()
        follow.heard = true
        liveThreads.opened()
        follow.live = true
        follow.tries = 0
      },
      onClose: (code) => {
        if (follow.channel === channel) drop(code)
      },
    })
    follow.channel = channel
  }

  const drop = (code: number) => {
    follow.channel = undefined
    if (follow.live) invalidate(OFFLINE)
    follow.live = false
    if (GIVE_UP.includes(code)) return
    follow.tries += 1
    const wait = Math.min(follow.heard ? MAX_WAIT_MS : MAX_WAIT_UNHEARD_MS, FIRST_WAIT_MS * 2 ** follow.tries)
    follow.retry = setTimeout(open, Math.random() * wait)
  }

  const check = () => {
    if (!follow.channel || Date.now() - follow.heardAt <= SILENT_MS) return
    follow.channel.close()
    drop(1006)
  }

  const wake = () => {
    if (document.visibilityState !== 'visible') return
    check()
    if (!follow.channel && follow.retry && follow.heard) open()
  }

  open()
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
