import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Admin, AgentContainer, SeatSignIn, Update, type UpdateAdmin } from '@fastmonkey/common/admin/admin.ts'
import { Deleted, List } from '@fastmonkey/common/api.ts'
import { OAuthGrant } from '@fastmonkey/common/team/oauth.ts'
import type { Me } from '@fastmonkey/common/team/team.ts'
import { request } from '@/lib/api-client'
import { ME_KEY } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const ADMIN_KEY = ['admin']
const UPDATE_POLL_MS = 2_000
const APPS_KEY = ['oauth-grants']
const APP_LIST = List(OAuthGrant)
const CONTAINER_LIST = List(AgentContainer)
const CONTAINERS_POLL_MS = 5_000
const DELETED_APP = Deleted('oauth_grant')

export function useAdmin() {
  return useQuery({
    queryKey: ADMIN_KEY,
    queryFn: () => request({ schema: Admin, path: '/api/admin' }),
    refetchInterval: (query) => query.state.data?.server.update?.status === 'running' ? UPDATE_POLL_MS : false,
  })
}

export function useUpdateAdmin(back = '/admin') {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAdmin) => request({ schema: Admin, path: '/api/admin', method: 'PATCH', body }),
    onSuccess: (admin) => {
      client.setQueryData(ADMIN_KEY, admin)
      client.setQueryData<Me | null>(ME_KEY, (me) => me && { ...me, publicUrl: admin.publicUrl })
      navigate(back, true)
    },
  })
}

export function useStartSeatSignIn() {
  return useMutation({ mutationFn: () => request({ schema: SeatSignIn, path: '/api/admin/seat-sign-ins', method: 'POST' }) })
}

export function useCompleteSeatSignIn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, code }: { id: string; code: string }) => request({ schema: SeatSignIn, path: `/api/admin/seat-sign-ins/${encodeURIComponent(id)}`, method: 'PATCH', body: { code } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ADMIN_KEY })
      void client.invalidateQueries({ queryKey: ['agents'] })
      navigate('/admin', true)
    },
  })
}

export function useStartUpdate() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: Update, path: '/api/updates', method: 'POST' }),
    onSuccess: (update) => client.setQueryData<Admin>(ADMIN_KEY, (admin) => admin && { ...admin, server: { ...admin.server, update } }),
  })
}

export function useOAuthGrants() {
  return useQuery({ queryKey: APPS_KEY, queryFn: () => request({ schema: APP_LIST, path: '/api/oauth/grants' }).then((page) => page.data) })
}

export function useDeleteOAuthGrant() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (grantId: string) => request({ schema: DELETED_APP, path: `/api/oauth/grants/${encodeURIComponent(grantId)}`, method: 'DELETE' }),
    onSuccess: (deleted) => client.setQueryData<OAuthGrant[]>(APPS_KEY, (grants) => grants?.filter((grant) => grant.id !== deleted.id)),
  })
}

export function useContainers() {
  return useQuery({ queryKey: ['containers'], queryFn: () => request({ schema: CONTAINER_LIST, path: '/api/admin/containers' }).then((page) => page.data), refetchInterval: CONTAINERS_POLL_MS })
}
