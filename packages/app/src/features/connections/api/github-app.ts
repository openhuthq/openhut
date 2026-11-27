import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { List } from '@openhut/common/api.ts'
import { GithubAppInfo, GithubAppLaunch, GithubInstallation, type CreateGithubApp } from '@openhut/common/connections/github-app.ts'
import { avatarUrl, type Owner } from '@/features/connections/github-setup'
import { request } from '@/lib/api-client'
import { openhut } from '@/lib/openhut'
import { GITHUB_APP_KEY, GITHUB_INSTALLATIONS_KEY, githubPublicOrgsKey, githubWaitsKey } from '@/lib/query-keys'
import { toastError } from '@/lib/toast'

const PATH = '/api/github-app'
const POLL_MS = 1000

export function useGithubApp({ live = false }: { live?: boolean } = {}) {
  return useQuery({ queryKey: GITHUB_APP_KEY, queryFn: () => request({ schema: GithubAppInfo, path: PATH }), refetchInterval: live ? POLL_MS : false })
}

export function useGithubAppChange<T>(fn: (body: T) => Promise<GithubAppInfo>) {
  const client = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: (info) => client.setQueryData(GITHUB_APP_KEY, info), onError: toastError })
}

export function useAskForGithub() {
  return useGithubAppChange(() => request({ schema: GithubAppInfo, path: `${PATH}/requests`, method: 'POST' }))
}

export function useGithubInstallations(enabled = true) {
  return useQuery({ queryKey: GITHUB_INSTALLATIONS_KEY, queryFn: () => request({ schema: List(GithubInstallation), path: '/api/github-app/installations' }), enabled })
}

const Waits = z.object({ data: z.array(z.object({ askId: z.string(), since: z.string() })) })

export function useWaiting(askId: string, enabled: boolean) {
  return useQuery({ queryKey: githubWaitsKey(askId), queryFn: () => request({ schema: Waits, path: `/api/github-app/waits?askId=${encodeURIComponent(askId)}` }), enabled, refetchInterval: 60_000 }).data?.data.length ?? 0
}

export const publicOrgsQuery = (login: string) => queryOptions({
  queryKey: githubPublicOrgsKey(login),
  staleTime: Infinity,
  retry: false,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Owner[]> => {
    const orgs = await openhut.github.publicOrgs({ login, signal })
    return Array.isArray(orgs) ? orgs.flatMap((org: { login?: unknown; avatar_url?: unknown }) => typeof org.login === 'string' ? [{ login: org.login, avatarUrl: typeof org.avatar_url === 'string' ? org.avatar_url : avatarUrl(org.login), org: true }] : []) : []
  },
})

export function createGithubApp(body: CreateGithubApp) {
  return request({ schema: GithubAppLaunch, path: PATH, method: 'POST', body })
}

export function removeGithubApp() {
  return request({ schema: GithubAppInfo, path: PATH, method: 'DELETE' })
}
