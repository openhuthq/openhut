import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AllowedDevice, Cloud, CloudAuthorization, CloudPairing, RecoveryKit, type UnlockCloud } from '@openhut/common/cloud/cloud.ts'
import { request } from '@/lib/api-client'
import { WORDS } from '@/lib/platform'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { notify } from '@/components/custom/toast'

const CLOUD_KEY = ['cloud']
const SIGN_IN_KEY = ['cloud-sign-in']
const OFFLINE_POLL_MS = 5000
const BUSY_POLL_MS = 700
const SHOW_DONE_MS = 60_000
const ON_POLL_MS = 10_000
const PAIRING_POLL_MS = 2000
const SIGN_IN_POLL_MS = 1500

export function useCloud() {
  const client = useQueryClient()
  const signingIn = useSigningIn()
  return useQuery({
    queryKey: CLOUD_KEY,
    queryFn: async () => {
      const cloud = await request({ schema: Cloud, computer: 'local', path: '/api/cloud' })
      const settling = client.getQueryData(SIGN_IN_KEY) && (cloud.status !== 'off' || cloud.signInError)
      if (settling) {
        client.setQueryData(SIGN_IN_KEY, false)
        landAfterSignIn(cloud)
      }
      return cloud
    },
    refetchInterval: (query) => signingIn && query.state.data?.status === 'off' ? SIGN_IN_POLL_MS : pollOf(query.state.data),
  })
}

export function useSigningIn(): boolean {
  return useQuery({ queryKey: SIGN_IN_KEY, queryFn: () => false, initialData: false, staleTime: Infinity }).data
}

export function enableCloud() {
  navigate('/settings/account?open=enable')
}

function landAfterSignIn(cloud: Cloud) {
  if (location.pathname === '/join') return
  if (new URLSearchParams(location.search).get('open') === 'enable') return
  if (cloud.status === 'locked' || !cloud.kit) navigate('/settings/account?open=enable', true)
}

function pollOf(cloud: Cloud | undefined): number | false {
  if (cloud?.status === 'locked') return PAIRING_POLL_MS
  if (cloud?.status === 'offline' || cloud?.backup.state === 'failed') return OFFLINE_POLL_MS
  if (cloud?.backup.state !== 'idle' && cloud) return BUSY_POLL_MS
  if (cloud?.status !== 'on') return false
  return justBackedUp(cloud) ? BUSY_POLL_MS * 5 : ON_POLL_MS
}

export function justBackedUp(cloud: Cloud): boolean {
  return Boolean(cloud.backup.at && Date.now() - Date.parse(cloud.backup.at) < SHOW_DONE_MS)
}

type PasskeyReply = { prf?: string; error?: string; passkeys?: boolean; message?: string }
type PasskeyBridge = { status: () => Promise<PasskeyReply>; create: (input: { email: string }) => Promise<PasskeyReply>; open: () => Promise<PasskeyReply> }
const passkey: PasskeyBridge | undefined = Reflect.get(window, 'openhut')?.passkey

export function useUnlock() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UnlockCloud) => request({ schema: Cloud, computer: 'local', path: '/api/cloud/unlock', method: 'POST', body }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function usePasskeys() {
  return useQuery({ queryKey: ['passkey-helper'], queryFn: async () => passkey ? await passkey.status() : { error: 'missing' }, staleTime: Infinity }).data
}

export async function passkeyPrf(create?: { email: string }): Promise<string> {
  const reply = create ? await passkey?.create(create) : await passkey?.open()
  if (reply?.prf) return reply.prf
  if (reply?.error === 'no-prf') throw new Error('Your password manager’s passkey can’t unlock OpenHut. Use Touch ID or your recovery kit.')
  if (reply?.error === 'canceled') throw new Error('Canceled.')
  throw new Error(reply?.message ? `Touch ID didn’t work: ${reply.message}` : 'Touch ID isn’t set up here. Unlock another way.')
}

export function usePasskeyUnlock() {
  const unlock = useUnlock()
  return useMutation({ mutationFn: async () => unlock.mutateAsync({ prf: await passkeyPrf() }) })
}

export function useAddPasskey() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (email: string) => request({ schema: Cloud, computer: 'local', path: '/api/cloud/passkeys', method: 'POST', body: { prf: await passkeyPrf({ email }) } }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function usePairing(enabled: boolean) {
  return useQuery({ queryKey: ['cloud-pairing'], queryFn: () => request({ schema: CloudPairing, computer: 'local', path: '/api/cloud/pairings', method: 'POST' }), enabled, staleTime: 14 * 60_000, refetchInterval: 14 * 60_000, retry: false })
}

export function useAllow() {
  return useMutation({ mutationFn: (code: string) => request({ schema: AllowedDevice, computer: 'local', path: '/api/cloud/devices', method: 'POST', body: { code } }) })
}

const NEW_KIT_HINT = 'If anyone else has your recovery kit, make a new kit so the old one stops working.'
export const REMOVE_DETAIL = `It can’t get anything new from OpenHut Cloud. Do this only if it’s lost, sold or not yours. ${NEW_KIT_HINT}`

export function useRemoveMac() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => request({ schema: Cloud, computer: 'local', path: `/api/cloud/devices/${encodeURIComponent(key)}`, method: 'DELETE' }),
    onSuccess: (cloud) => {
      client.setQueryData(CLOUD_KEY, cloud)
      notify({ title: 'Device removed', note: NEW_KIT_HINT, action: { label: 'Make a new kit', onClick: () => navigate('/settings/account?open=kit') } })
    },
    onError: toastError,
  })
}

export function useStartOver() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: Cloud, computer: 'local', path: '/api/cloud/key-boxes', method: 'DELETE' }),
    onSuccess: (cloud) => {
      client.setQueryData(CLOUD_KEY, cloud)
      navigate('/settings/account?open=kit', true)
    },
  })
}

const bridge: { notify: () => Promise<{ shown?: boolean }> } | undefined = Reflect.get(window, 'openhut')?.cloud

export async function notifyUnlock(): Promise<boolean> {
  return Boolean((await bridge?.notify().catch(() => undefined))?.shown)
}

export function useSignIn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: CloudAuthorization, computer: 'local', path: '/api/cloud/sessions', method: 'POST' }),
    onSuccess: ({ authorizationUrl }) => {
      window.open(authorizationUrl, '_blank', 'noopener')
      client.setQueryData(SIGN_IN_KEY, true)
    },
  })
}

export function useCancelSignIn() {
  const client = useQueryClient()
  return () => client.setQueryData(SIGN_IN_KEY, false)
}

export function useSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: Cloud, computer: 'local', path: '/api/cloud/session', method: 'DELETE' }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function useNewKit() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: RecoveryKit, computer: 'local', path: '/api/cloud/kits', method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: CLOUD_KEY }),
  })
}

export function nameOf(email: string): string {
  const first = (email.split('@')[0] ?? '').split(/[._+-]/)[0] ?? ''
  return first.charAt(0).toUpperCase() + first.slice(1)
}
