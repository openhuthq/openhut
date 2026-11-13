import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Deleted } from '@jakebox/common/api.ts'
import { OAuthClient, OAuthCode, type CreateOAuthCode } from '@jakebox/common/team/oauth.ts'
import { InviteLink, Me, Setup, type CreatePerson, type CreateSession } from '@jakebox/common/team/team.ts'
import { request, RequestError } from '@/lib/api-client'
import { ME_KEY } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const DELETED_SESSION = Deleted('session')

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => request({ schema: Me, path: '/api/me' }).catch((error: unknown) => {
      if (error instanceof RequestError && error.status === 401) return null
      throw error
    }),
  })
}

export function useSetup(enabled = true) {
  return useQuery({ queryKey: ['setup'], enabled, queryFn: () => request({ schema: Setup, path: '/api/setup' }) })
}

export function useInviteLink(token: string) {
  return useQuery({ queryKey: ['invite-links', token], retry: false, queryFn: () => request({ schema: InviteLink, path: `/api/invite-links/${encodeURIComponent(token)}` }) })
}

export function useOAuthClient(clientId: string) {
  return useQuery({ queryKey: ['oauth-clients', clientId], enabled: clientId !== '', queryFn: () => request({ schema: OAuthClient, path: `/api/oauth/clients/${encodeURIComponent(clientId)}` }) })
}

export function nextPath() {
  const next = new URLSearchParams(location.search).get('next')
  if (next && /^\/(?![/\\])/.test(next)) return next
  return '/agents'
}

export function useCreateSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateSession) => request({ schema: Me, path: '/api/sessions', method: 'POST', body }),
    onSuccess: (me) => signedIn(client, me),
  })
}

export function useCreatePerson() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreatePerson) => request({ schema: Me, path: '/api/people', method: 'POST', body }),
    onSuccess: (me) => signedIn(client, me),
  })
}

export function useDeleteSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: DELETED_SESSION, path: '/api/sessions/current', method: 'DELETE' }),
    onSuccess: () => {
      client.clear()
      client.setQueryData(ME_KEY, null)
      navigate('/login', true)
    },
  })
}

export function useCreateOAuthCode() {
  return useMutation({
    mutationFn: (body: CreateOAuthCode) => request({ schema: OAuthCode, path: '/api/oauth/codes', method: 'POST', body }),
    onSuccess: (code) => {
      if (code.redirect) location.href = code.redirect
    },
  })
}

function signedIn(client: QueryClient, me: Me) {
  const to = nextPath()
  client.setQueryData(ME_KEY, me)
  navigate(to, true)
}
