import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cloud, CloudAuthorization, RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { request } from '@/lib/api-client'
import { navigate } from '@/lib/router'

const CLOUD_KEY = ['cloud']
const SIGN_IN_KEY = ['cloud-sign-in']
const OFFLINE_POLL_MS = 5000
const BUSY_POLL_MS = 700
const SHOW_DONE_MS = 60_000
const ON_POLL_MS = 10_000

export function useCloud() {
  const client = useQueryClient()
  const signingIn = useQuery({ queryKey: SIGN_IN_KEY, queryFn: () => false, initialData: false, staleTime: Infinity }).data
  return useQuery({
    queryKey: CLOUD_KEY,
    queryFn: async () => {
      const cloud = await request({ schema: Cloud, computer: 'local', path: '/api/cloud' })
      if (cloud.status === 'off' && cloud.signInError && client.getQueryData(SIGN_IN_KEY)) {
        client.setQueryData(SIGN_IN_KEY, false)
        navigate('/settings/cloud', true)
      }
      if (cloud.status !== 'off' && client.getQueryData(SIGN_IN_KEY)) {
        client.setQueryData(SIGN_IN_KEY, false)
        if (cloud.status !== 'locked') navigate(cloud.kit ? '/settings/cloud' : '/settings/cloud?open=kit', true)
      }
      return cloud
    },
    refetchInterval: (query) => signingIn && query.state.data?.status === 'off' ? OFFLINE_POLL_MS : pollOf(query.state.data),
  })
}

function pollOf(cloud: Cloud | undefined): number | false {
  if (cloud?.status === 'offline' || cloud?.backup.state === 'failed') return OFFLINE_POLL_MS
  if (cloud?.backup.state !== 'idle' && cloud) return BUSY_POLL_MS
  if (cloud?.status !== 'on') return false
  return justBackedUp(cloud) ? BUSY_POLL_MS * 5 : ON_POLL_MS
}

export function justBackedUp(cloud: Cloud): boolean {
  return Boolean(cloud.backup.at && Date.now() - Date.parse(cloud.backup.at) < SHOW_DONE_MS)
}

export function useUnlock() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (words: string[]) => request({ schema: Cloud, computer: 'local', path: '/api/cloud/unlock', method: 'POST', body: { words } }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function useStartOver() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: Cloud, computer: 'local', path: '/api/cloud/key-boxes', method: 'DELETE' }),
    onSuccess: (cloud) => {
      client.setQueryData(CLOUD_KEY, cloud)
      navigate('/settings/cloud?open=kit', true)
    },
  })
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

export function useForget() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: Cloud, computer: 'local', path: '/api/cloud/account', method: 'DELETE' }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function nameOf(email: string): string {
  const first = (email.split('@')[0] ?? '').split(/[._+-]/)[0] ?? ''
  return first.charAt(0).toUpperCase() + first.slice(1)
}
