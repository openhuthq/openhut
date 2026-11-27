import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Admin, CodexSignIn, SeatSignIn, SeatUsage } from '@openhut/common/admin/admin.ts'
import { Provider, type ProviderId } from '@openhut/common/models/provider.ts'
import { foundNotice } from '@/lib/models'
import { request } from '@/lib/api-client'
import { toastError } from '@/lib/toast'
import { ADMIN_KEY, AGENTS_KEY, codexSignInKey, PROVIDERS_KEY, SEAT_USAGE_KEY } from '@/lib/query-keys'

const pathOf = (id: ProviderId) => `/api/providers/${id}`

export function useFoundNotice() {
  const client = useQueryClient()
  return (id: ProviderId) => foundNotice({ provider: client.getQueryData<Provider[]>(PROVIDERS_KEY)?.find((each) => each.id === id) })
}

export function useConnectProvider() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, apiKey, baseUrl }: { id: ProviderId; apiKey: string; baseUrl?: string }) => request({ schema: Provider, path: pathOf(id), method: 'PATCH', body: { apiKey, baseUrl } }),
    onSuccess: () => client.invalidateQueries({ queryKey: PROVIDERS_KEY }),
  })
}

export function useRefreshProvider() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: ProviderId) => request({ schema: Provider, path: `${pathOf(id)}/refresh`, method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: PROVIDERS_KEY }),
  })
}

export function useDisconnectProvider() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: ProviderId) => request({ schema: Provider, path: pathOf(id), method: 'DELETE' }),
    onError: toastError,
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: PROVIDERS_KEY }), client.invalidateQueries({ queryKey: AGENTS_KEY })]),
  })
}

export function useSetModel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: ProviderId; model: string; on: boolean }) => request({ schema: Provider, path: pathOf(input.id), method: 'PATCH', body: { models: [{ id: input.model, on: input.on }] } }),
    onMutate: ({ id, model, on }) => {
      client.setQueryData<Provider[]>(PROVIDERS_KEY, (providers) => providers?.map((provider) => provider.id === id ? { ...provider, models: provider.models.map((each) => each.id === model ? { ...each, on } : each) } : provider))
    },
    onSettled: () => client.invalidateQueries({ queryKey: PROVIDERS_KEY }),
  })
}

export function useCodexSignIn(onSignedIn: () => void) {
  const client = useQueryClient()
  const started = useRef(false)
  const finished = useRef(false)
  const start = useMutation({ mutationFn: () => request({ schema: CodexSignIn, path: '/api/admin/codex-sign-ins', method: 'POST' }) })
  const id = start.data?.id
  const poll = useQuery({
    queryKey: codexSignInKey(id),
    enabled: !!id,
    queryFn: () => request({ schema: CodexSignIn, path: `/api/admin/codex-sign-ins/${encodeURIComponent(id ?? '')}` }),
    refetchInterval: (query) => query.state.data?.status === 'complete' ? false : 2500,
    retry: false,
    gcTime: 0,
  })
  const { mutate } = start
  useEffect(() => {
    if (started.current) return
    started.current = true
    mutate()
  }, [mutate])
  const done = poll.data?.status === 'complete'
  useEffect(() => {
    if (!done || finished.current) return
    finished.current = true
    void client.invalidateQueries({ queryKey: PROVIDERS_KEY }).then(onSignedIn)
  }, [done, client, onSignedIn])
  return { signIn: start.data, error: start.error ?? poll.error, restart: () => start.mutate() }
}

export function useAdmin() {
  return useQuery({ queryKey: ADMIN_KEY, queryFn: () => request({ schema: Admin, computer: 'local', path: '/api/admin' }) })
}

export function useSeatUsage(enabled: boolean) {
  return useQuery({ queryKey: SEAT_USAGE_KEY, queryFn: () => request({ schema: SeatUsage, computer: 'local', path: '/api/admin/seat-usage' }), retry: false, enabled })
}

export function useStartSeatSignIn() {
  return useMutation({ mutationFn: () => request({ schema: SeatSignIn, computer: 'local', path: '/api/admin/seat-sign-ins', method: 'POST' }) })
}

export function useCompleteSeatSignIn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, code }: { id: string; code: string }) => request({ schema: SeatSignIn, computer: 'local', path: `/api/admin/seat-sign-ins/${encodeURIComponent(id)}`, method: 'PATCH', body: { code } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ADMIN_KEY })
      void client.invalidateQueries({ queryKey: AGENTS_KEY })
      void client.invalidateQueries({ queryKey: PROVIDERS_KEY })
    },
  })
}

