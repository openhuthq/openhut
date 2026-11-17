import { createOpenHut, type Platform, type StoredComputer, type TailnetPeer } from '@openhut/client'

export type Enrollment = { peer: TailnetPeer; lines: string[]; url: string | null; startedAt: number; status: 'running' | 'failed'; error: string; retryAt: number | null; retried: boolean }
type Failure = { error: string }
type Computers = {
  list: () => Promise<StoredComputer[]>
  add: (input: { peer: TailnetPeer }) => Promise<StoredComputer | Failure>
  adopt: (input: { name: string; url: string; key: string }) => Promise<StoredComputer | Failure>
  remove: (input: { id: string }) => Promise<{ id: string } | Failure>
  enrollments: () => Promise<Enrollment[]>
  dismiss: (input: { dns: string }) => Promise<unknown>
  onEnrollments: (listener: (list: Enrollment[]) => void) => void
}

const bridge: { computers: Computers } | undefined = Reflect.get(window, 'openhut')
const BROWSER: StoredComputer[] = [{ id: 'local', name: 'This computer', url: '' }]

async function answer<T extends object>(call: Promise<T | Failure> | undefined): Promise<T> {
  const result = await call
  if (!result) throw new Error('Open the OpenHut app on this computer to do this.')
  if ('error' in result) throw new Error(result.error)
  return result
}

const platform: Platform = {
  transport: (computer) => (path, init) => fetch(bridge ? `/c/${computer.id}${path}` : path, init),
  store: {
    computers: async () => bridge ? bridge.computers.list() : BROWSER,
    add: (peer) => answer(bridge?.computers.add({ peer })),
    adopt: (input) => answer(bridge?.computers.adopt(input)),
    remove: async (id) => { await answer(bridge?.computers.remove({ id })) },
  },
  openUrl: (url) => { window.open(url, '_blank') },
}

export const openhut = createOpenHut(platform)

export const enrollments = {
  list: async (): Promise<Enrollment[]> => await bridge?.computers.enrollments() ?? [],
  dismiss: (dns: string) => bridge?.computers.dismiss({ dns }),
  follow: (listener: (list: Enrollment[]) => void) => bridge?.computers.onEnrollments(listener),
}

const homes = new Map<string, string>()

export function rememberHomes(things: { id: string; computer: string }[]) {
  for (const thing of things) homes.set(thing.id, thing.computer)
}

export function onComputer({ computer, path }: { computer: string; path: string }) {
  return bridge && computer !== 'local' ? `/c/${computer}${path}` : path
}

export function at({ id, path }: { id: string; path: string }) {
  return onComputer({ computer: homes.get(id) ?? 'local', path })
}

export function on({ agentId, path }: { agentId: string; path: string }) {
  return at({ id: agentId, path })
}
