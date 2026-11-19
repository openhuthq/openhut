import { createOpenHut, type Device, type Platform, type StoredComputer, type TailnetPeer } from '@openhut/client'
import { isPhone } from '@/lib/native'
import { phonePlatform } from '@/lib/phone'

export type Enrollment = { peer: TailnetPeer; lines: string[]; url: string | null; startedAt: number; status: 'running' | 'failed'; error: string; retryAt: number | null; retried: boolean }
type Failure = { error: string }
type Computers = {
  list: () => Promise<StoredComputer[]>
  add: (input: { peer: TailnetPeer }) => Promise<StoredComputer | Failure>
  remove: (input: { id: string }) => Promise<{ id: string } | Failure>
  enrollments: () => Promise<Enrollment[]>
  dismiss: (input: { dns: string }) => Promise<unknown>
  onEnrollments: (listener: (list: Enrollment[]) => void) => void
}

type Devices = {
  list: () => Promise<Device[] | Failure>
  remove: (input: { key: string }) => Promise<Device[] | Failure>
  allow: (input: { id: string }) => Promise<{ id: string } | Failure>
}

const bridge: { computers: Computers; devices?: Devices; version?: string } | undefined = Reflect.get(window, 'openhut')
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
    remove: async (id) => { await answer(bridge?.computers.remove({ id })) },
  },
  openUrl: (url) => { window.open(url, '_blank') },
  appVersion: bridge?.version,
}

export const openhut = createOpenHut(isPhone() ? phonePlatform : platform)

export const enrollments = {
  list: async (): Promise<Enrollment[]> => await bridge?.computers.enrollments() ?? [],
  dismiss: (dns: string) => bridge?.computers.dismiss({ dns }),
  follow: (listener: (list: Enrollment[]) => void) => bridge?.computers.onEnrollments(listener),
}

export const devices = {
  list: (): Promise<Device[]> => bridge?.devices ? answer(bridge.devices.list()) : openhut.access.list(),
  remove: (key: string): Promise<Device[]> => answer(bridge?.devices?.remove({ key })),
  allow: (id: string): Promise<{ id: string }> => answer(bridge?.devices?.allow({ id })),
}
