import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudOffIcon, FingerPrintIcon, Key01Icon } from '@hugeicons/core-free-icons'
import { Cloud, CloudAuthorization, RecoveryKit, type EncryptionPasskey, type UnlockCloud } from '@openhut/common/cloud/cloud.ts'
import { request } from '@/lib/api-client'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { notify } from '@/components/custom/toast'
import { desktop } from '@/lib/desktop'
import { REMOTE, remote } from '@/lib/remote'

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
      if (client.getQueryData(SIGN_IN_KEY) && cloud.status !== 'off') void desktop?.focus?.().catch(() => undefined)
      if (client.getQueryData(SIGN_IN_KEY) && (cloud.status !== 'off' || cloud.signInError)) client.setQueryData(SIGN_IN_KEY, false)
      return cloud
    },
    refetchInterval: (query) => !query.state.data || (signingIn && query.state.data.status === 'off') ? SIGN_IN_POLL_MS : pollOf(query.state.data),
    refetchIntervalInBackground: true,
  })
}

export function useSigningIn(): boolean {
  return useQuery({ queryKey: SIGN_IN_KEY, queryFn: () => false, initialData: false, staleTime: Infinity }).data
}

function pollOf(cloud: Cloud | undefined): number | false {
  if (cloud?.status === 'locked') return PAIRING_POLL_MS
  if (cloud?.status === 'offline' || cloud?.backup.state === 'failed') return OFFLINE_POLL_MS
  if (cloud?.backup.state !== 'idle' && cloud) return BUSY_POLL_MS
  if (cloud?.status !== 'on') return false
  return cloud.backup.at && Date.now() - Date.parse(cloud.backup.at) < SHOW_DONE_MS ? BUSY_POLL_MS * 5 : ON_POLL_MS
}

const passkey = desktop?.passkey

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

export class PasskeyQuiet extends Error {}

export async function passkeyPrf({ create, quiet = false }: { create?: { email: string }; quiet?: boolean } = {}): Promise<string> {
  const reply = create ? await passkey?.create(create) : await passkey?.open({ quiet })
  if (reply?.prf) return reply.prf
  if (reply?.error === 'no-prf') throw new Error('Your password manager can’t unlock OpenHut. Use Touch ID or your recovery kit.')
  if (reply?.error === 'canceled' || reply?.error === 'none-here') throw new PasskeyQuiet('Canceled.')
  if (reply?.message?.includes('not associated')) throw new Error('This copy of OpenHut can’t use Touch ID. Use the app from openhut.dev, or unlock another way.')
  throw new Error(reply?.message ? `Touch ID didn’t work: ${reply.message}` : 'Touch ID isn’t set up here. Unlock another way.')
}

export const cancelPasskey = (): void => void passkey?.cancel()

export function usePasskeyUnlock() {
  const unlock = useUnlock()
  return useMutation({ mutationFn: async (quiet?: boolean) => unlock.mutateAsync({ prf: await passkeyPrf({ quiet }) }) })
}

export function useAddPasskey() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (email: string | null) => request({ schema: Cloud, computer: 'local', path: '/api/cloud/passkeys', method: 'POST', body: { prf: await passkeyPrf(email ? { create: { email } } : {}) } }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function useRemovePasskey() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: Cloud, computer: 'local', path: '/api/cloud/passkeys', method: 'DELETE' }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function useSetEncryption() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (on: boolean) => request({ schema: Cloud, computer: 'local', path: '/api/cloud/encryption', method: 'POST', body: { on } }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function usePrepareEncryption() {
  return useMutation({ mutationFn: () => request({ schema: RecoveryKit, computer: 'local', path: '/api/cloud/encryption/keys', method: 'POST' }) })
}

export function useEncryptionPasskey() {
  return useMutation({ mutationFn: (passkey: EncryptionPasskey) => request({ schema: Cloud, computer: 'local', path: '/api/cloud/encryption/passkeys', method: 'POST', body: passkey }) })
}

const NEW_KIT_HINT = 'If someone else has your kit, make a new one.'
export const REMOVE_DETAIL = 'Only if it’s lost, sold or not yours.'
export const REMOVE_POINTS = [
  { icon: CloudOffIcon, text: 'It can’t get anything new from OpenHut Cloud, and OpenHut on it locks and clears this account’s chats' },
  { icon: FingerPrintIcon, text: 'Touch ID turns off until you add it again' },
  { icon: Key01Icon, text: 'Make a new kit if someone else has yours' },
]

export const LOST_POINTS = [
  { icon: CloudOffIcon, text: 'It’s removed, and your encryption resets, so it can’t read anything new even with what it kept' },
  { icon: Key01Icon, text: 'You save a new recovery kit; the old one stops working' },
  { icon: FingerPrintIcon, text: 'Touch ID turns off until you add it again' },
]

export function useRemoveMac() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ key, lost = false }: { key: string; lost?: boolean }) => request({ schema: Cloud, computer: 'local', path: `/api/cloud/devices/${encodeURIComponent(key)}${lost ? '?lost=true' : ''}`, method: 'DELETE' }),
    onSuccess: (cloud, { lost }) => {
      client.setQueryData(CLOUD_KEY, cloud)
      if (lost) {
        notify({ title: 'Device removed and locked out', note: 'Save your new recovery kit.' })
        return navigate('/settings/security?open=kit')
      }
      notify({ title: 'Device removed', note: NEW_KIT_HINT, action: { label: 'New kit', onClick: () => navigate('/settings/security?open=kit') } })
    },
    onError: toastError,
  })
}

const bridge = desktop?.cloud

export async function notifyUnlock(): Promise<boolean> {
  return Boolean((await bridge?.notify().catch(() => undefined))?.shown)
}

export function notifyDesktop(input: { title: string; body: string; path: string }): void {
  void bridge?.notify(input).catch(() => undefined)
}

export async function knockDesktop(input: { title: string; body: string }): Promise<'open' | 'not-me' | null> {
  return (await bridge?.knock?.(input).catch(() => undefined))?.action ?? null
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

export function useNewKit() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: RecoveryKit, computer: 'local', path: '/api/cloud/kits', method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: CLOUD_KEY }),
  })
}

export { nameOf } from '@/features/cloud/seen'
