import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mergeProviders, type ProviderRow } from '@openhut/client'
import { CodexSignIn } from '@openhut/common/admin/admin.ts'
import type { Provider, ProviderId } from '@openhut/common/models/provider.ts'
import { foundNotice } from '@/features/models/labels'
import { request } from '@/lib/api-client'
import { openhut } from '@/lib/openhut'
import { toastError } from '@/lib/toast'
import { AGENTS_KEY, PROVIDERS_KEY } from '@/lib/query-keys'

export function useProviders() {
  return useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => openhut.providers.list() })
}

export function useMergedProviders() {
  const rows = useProviders().data
  return rows && mergeProviders(rows)
}

export function useFoundNotice() {
  const client = useQueryClient()
  return (id: ProviderId) => foundNotice({ provider: mergeProviders(client.getQueryData<ProviderRow[]>(PROVIDERS_KEY) ?? []).find((each) => each.id === id) })
}

export function useComputerProviders(computer: string): Provider[] | undefined {
  return useProviders().data?.find((row) => row.computer === computer)?.providers
}

export function useConnectProvider() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: ProviderId; apiKey: string; computers: string[] }) => openhut.providers.connect(input),
    onSuccess: () => client.invalidateQueries({ queryKey: PROVIDERS_KEY }),
  })
}

export function useRefreshProvider() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: ProviderId) => openhut.providers.refresh(id),
    onSuccess: () => client.invalidateQueries({ queryKey: PROVIDERS_KEY }),
  })
}

export function useDisconnectProvider() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: ProviderId) => openhut.providers.disconnect(id),
    onError: toastError,
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: PROVIDERS_KEY }), client.invalidateQueries({ queryKey: AGENTS_KEY })]),
  })
}

export function useSetModel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: ProviderId; model: string; on: boolean }) => openhut.providers.setModels({ id: input.id, models: [{ id: input.model, on: input.on }] }),
    onMutate: ({ id, model, on }) => {
      client.setQueryData<ProviderRow[]>(PROVIDERS_KEY, (rows) => rows?.map((row) => ({ ...row, providers: row.providers.map((provider) => provider.id === id ? { ...provider, models: provider.models.map((each) => each.id === model ? { ...each, on } : each) } : provider) })))
    },
    onSettled: () => client.invalidateQueries({ queryKey: PROVIDERS_KEY }),
  })
}

export function useCodexSignIn(onSignedIn: () => void) {
  const client = useQueryClient()
  const started = useRef(false)
  const finished = useRef(false)
  const start = useMutation({ mutationFn: () => request({ schema: CodexSignIn, computer: 'local', path: '/api/admin/codex-sign-ins', method: 'POST' }) })
  const id = start.data?.id
  const poll = useQuery({
    queryKey: ['codex-sign-in', id],
    enabled: !!id,
    queryFn: () => request({ schema: CodexSignIn, computer: 'local', path: `/api/admin/codex-sign-ins/${encodeURIComponent(id ?? '')}` }),
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
