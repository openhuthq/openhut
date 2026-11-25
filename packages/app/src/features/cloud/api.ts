import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudOffIcon } from '@hugeicons/core-free-icons'
import { Cloud, CloudAuthorization } from '@openhut/common/cloud/cloud.ts'
import { request } from '@/lib/api-client'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { notify } from '@/components/custom/toast'
import { NoComputer, REMOTE, remote } from '@/lib/remote'
import { nameOf } from '@/features/cloud/seen'

const CLOUD_KEY = ['cloud']
const SIGN_IN_KEY = ['cloud-sign-in']
const OFFLINE_POLL_MS = 5000
const BUSY_POLL_MS = 700
const SHOW_DONE_MS = 60_000
const ON_POLL_MS = 10_000
const PAIRING_POLL_MS = 2000
const SIGN_IN_POLL_MS = 1500
const CLOUD_COMPUTER_KEY = ['cloud-computer']
const MOVING = ['creating', 'stopping', 'waking']

export const CLOUD_NOTE = 'We run it, so we can see what’s on it'

// The person's Cloud computer (null when they have none). Only the web App talks to the Cloud directly.
export function useCloudComputer() {
  return useQuery({ queryKey: CLOUD_COMPUTER_KEY, queryFn: remote.cloudComputer, enabled: REMOTE, refetchInterval: (query) => MOVING.includes(query.state.data?.state ?? '') ? PAIRING_POLL_MS : ON_POLL_MS })
}

// The joined Cloud computer's id in a computers list: its device key, or 'local' when it's the computer this browser talks to
// (the list holds every device but that one).
export function useCloudId(computers: { id: string }[]): string | undefined {
  const device = useCloudComputer().data?.device
  if (!device) return undefined
  return computers.some((each) => each.id === device) ? device : 'local'
}

export function useStartCloud() {
  const client = useQueryClient()
  return useMutation({ mutationFn: remote.startCloud, onSuccess: (started) => client.setQueryData(CLOUD_COMPUTER_KEY, started) })
}

export function useCloud() {
  const client = useQueryClient()
  const signingIn = useSigningIn()
  return useQuery({
    queryKey: CLOUD_KEY,
    queryFn: async () => {
      const cloud = await request({ schema: Cloud, computer: 'local', path: '/api/cloud' }).catch(async (err: unknown) => { if (err instanceof NoComputer) return noComputerYet(); throw err })
      if (client.getQueryData(SIGN_IN_KEY) && (cloud.status !== 'off' || cloud.signInError)) client.setQueryData(SIGN_IN_KEY, false)
      return cloud
    },
    refetchInterval: (query) => !query.state.data || (signingIn && query.state.data.status === 'off') ? SIGN_IN_POLL_MS : pollOf(query.state.data),
    refetchIntervalInBackground: true,
  })
}

// A new account before its first agent: just its own team, from OpenHut Cloud, until Cloud joins and answers for itself.
async function noComputerYet(): Promise<Cloud> {
  const me = await remote.me()
  if (!me?.home) throw new NoComputer()
  return {
    object: 'cloud', status: 'on', email: me.email, device: null, workspace: null, keyStore: 'file', signInError: null, devices: [], needsSignIn: false, asking: null, canAsk: false, rotate: [], gone: [],
    backup: { state: 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null },
    workspaces: [{ id: me.home, name: `${nameOf(me.email)}’s team`, website: null, home: true, own: true, role: 'owner', waiting: false, members: [{ email: me.email, role: 'owner', devices: [] }], invites: [], requests: [], names: {} }],
  }
}

export function useSigningIn(): boolean {
  return useQuery({ queryKey: SIGN_IN_KEY, queryFn: () => false, initialData: false, staleTime: Infinity }).data
}

function pollOf(cloud: Cloud | undefined): number | false {
  if (cloud?.status === 'offline' || cloud?.backup.state === 'failed') return OFFLINE_POLL_MS
  if (cloud?.backup.state !== 'idle' && cloud) return BUSY_POLL_MS
  if (cloud?.status !== 'on') return false
  return cloud.backup.at && Date.now() - Date.parse(cloud.backup.at) < SHOW_DONE_MS ? BUSY_POLL_MS * 5 : ON_POLL_MS
}

export const REMOVE_DETAIL = 'Only if it’s lost, sold or not yours.'
export const REMOVE_POINTS = [
  { icon: CloudOffIcon, text: 'It can’t get anything new from OpenHut Cloud, and OpenHut on it locks and clears this account’s chats' },
]

export const LOST_POINTS = [
  { icon: CloudOffIcon, text: 'It’s removed, and your keys change, so it can’t read anything new even with what it kept' },
]

export function useRemoveMac() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ key, lost = false }: { key: string; lost?: boolean }) => request({ schema: Cloud, computer: 'local', path: `/api/cloud/devices/${encodeURIComponent(key)}${lost ? '?lost=true' : ''}`, method: 'DELETE' }),
    onSuccess: (cloud, { lost }) => {
      client.setQueryData(CLOUD_KEY, cloud)
      notify({ title: lost ? 'Device removed and locked out' : 'Device removed' })
    },
    onError: toastError,
  })
}

export function useSignIn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (loginHint?: string) => request({ schema: CloudAuthorization, computer: 'local', path: '/api/cloud/sessions', method: 'POST', body: loginHint ? { loginHint } : undefined }),
    onSuccess: ({ authorizationUrl }) => {
      window.open(authorizationUrl, '_blank', 'noopener')
      client.setQueryData(SIGN_IN_KEY, true)
    },
  })
}

export function usePasteSignInCode() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => request({ schema: Cloud, computer: 'local', path: '/api/cloud/sessions/codes', method: 'POST', body: { code } }),
    onSuccess: (cloud) => {
      client.setQueryData(CLOUD_KEY, cloud)
      client.setQueryData(SIGN_IN_KEY, false)
    },
  })
}

export function useCancelSignIn() {
  const client = useQueryClient()
  return () => client.setQueryData(SIGN_IN_KEY, false)
}

export function useSignOut({ stay = false }: { stay?: boolean } = {}) {
  const client = useQueryClient()
  return useMutation({
    // A browser or phone signs only itself out; the computer's own session stays (its runtime refuses a remote sign-out).
    mutationFn: async () => {
      if (!REMOTE) return request({ schema: Cloud, computer: 'local', path: '/api/cloud/session', method: 'DELETE' })
      await remote.signOut()
      location.assign('/')
      return new Promise<never>(() => undefined)
    },
    onSuccess: (cloud) => {
      client.setQueryData(CLOUD_KEY, cloud)
      if (!stay) navigate('/', true)
      void client.invalidateQueries()
    },
  })
}

export { nameOf } from '@/features/cloud/seen'
