import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cloud, CloudAuthorization, RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { request } from '@/lib/api-client'

const CLOUD_KEY = ['cloud']
const OFFLINE_POLL_MS = 5000

export function useCloud() {
  return useQuery({ queryKey: CLOUD_KEY, queryFn: () => request({ schema: Cloud, computer: 'local', path: '/api/cloud' }), refetchInterval: (query) => query.state.data?.status === 'offline' ? OFFLINE_POLL_MS : false })
}

export function useSignIn() {
  return useMutation({
    mutationFn: () => request({ schema: CloudAuthorization, computer: 'local', path: '/api/cloud/sessions', method: 'POST', body: { returnTo: location.origin } }),
    onSuccess: ({ authorizationUrl }) => location.assign(authorizationUrl),
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
  return useMutation({ mutationFn: () => request({ schema: RecoveryKit, computer: 'local', path: '/api/cloud/kits', method: 'POST' }) })
}

export function useConfirmKit() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (words: string[]) => request({ schema: Cloud, computer: 'local', path: '/api/cloud/kits/confirm', method: 'POST', body: { words } }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function nameOf(email: string): string {
  const local = email.split('@')[0] ?? ''
  return local.charAt(0).toUpperCase() + local.slice(1)
}
