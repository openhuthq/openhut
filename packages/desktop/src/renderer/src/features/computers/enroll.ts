import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { TailnetPeer } from '@openhut/client'
import { onEnrollProgress, openhut } from '@/lib/openhut'
import { COMPUTERS_KEY } from '@/lib/query-keys'
import { failureOf } from '@/features/computers/enroll-steps'

export type Enrollment = { peer: TailnetPeer; lines: string[]; url: string | null; startedAt: number; status: 'running' | 'failed'; error: string; retryAt: number | null; retried: boolean; expanded?: boolean }

export const ENROLL_KEY = ['enrollments']
const RETRY_MS = 60_000

export function useEnrollments() {
  return useQuery<Enrollment[]>({ queryKey: ENROLL_KEY, queryFn: () => [], initialData: [], staleTime: Infinity })
}

export function followEnrollments(client: QueryClient) {
  onEnrollProgress((progress) => change({ client, dns: progress.peer, patch: (each) => ({ lines: [...each.lines, progress.line], url: progress.url ?? each.url }) }))
}

export function useEnroll() {
  const client = useQueryClient()
  return {
    start: (peer: TailnetPeer) => start({ client, peer, retried: false }),
    toggle: (dns: string, open: boolean) => change({ client, dns, patch: () => ({ expanded: open }) }),
    dismiss: (dns: string) => client.setQueryData<Enrollment[]>(ENROLL_KEY, (list = []) => list.filter((each) => each.peer.dns !== dns)),
  }
}

function start({ client, peer, retried }: { client: QueryClient; peer: TailnetPeer; retried: boolean }) {
  const fresh: Enrollment = { peer, lines: [], url: null, startedAt: Date.now(), status: 'running', error: '', retryAt: null, retried }
  client.setQueryData<Enrollment[]>(ENROLL_KEY, (list = []) => [...list.filter((each) => each.peer.dns !== peer.dns), fresh])
  openhut.computers.add(peer).then(() => {
    client.setQueryData<Enrollment[]>(ENROLL_KEY, (list = []) => list.filter((each) => each.peer.dns !== peer.dns))
    void client.invalidateQueries({ queryKey: COMPUTERS_KEY })
    if (!document.hasFocus()) new Notification(`${peer.name} is ready`, { body: 'Its agents can run there now.' })
  }, (error: Error) => {
    const busy = failureOf({ error: error.message, url: null, name: peer.name }).kind === 'busy'
    const retryAt = busy && !retried ? Date.now() + RETRY_MS : null
    change({ client, dns: peer.dns, patch: () => ({ status: 'failed', error: error.message, retryAt }) })
    if (retryAt) setTimeout(() => {
      const still = client.getQueryData<Enrollment[]>(ENROLL_KEY)?.find((each) => each.peer.dns === peer.dns)
      if (still?.status === 'failed' && still.retryAt === retryAt) start({ client, peer, retried: true })
    }, RETRY_MS)
  })
}

function change({ client, dns, patch }: { client: QueryClient; dns: string; patch: (each: Enrollment) => Partial<Enrollment> }) {
  client.setQueryData<Enrollment[]>(ENROLL_KEY, (list = []) => list.map((each) => each.peer.dns === dns ? { ...each, ...patch(each) } : each))
}
