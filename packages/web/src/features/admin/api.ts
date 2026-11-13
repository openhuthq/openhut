import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Admin, type UpdateAdmin } from '@jakebox/common/admin/admin.ts'
import { Deleted, List } from '@jakebox/common/api.ts'
import { OAuthGrant } from '@jakebox/common/team/oauth.ts'
import type { Me } from '@jakebox/common/team/team.ts'
import { request } from '@/lib/api-client'
import { ME_KEY } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const ADMIN_KEY = ['admin']
const APPS_KEY = ['oauth-grants']
const APP_LIST = List(OAuthGrant)
const DELETED_APP = Deleted('oauth_grant')

export function useAdmin() {
  return useQuery({ queryKey: ADMIN_KEY, queryFn: () => request({ schema: Admin, path: '/api/admin' }) })
}

export function useUpdateAdmin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAdmin) => request({ schema: Admin, path: '/api/admin', method: 'PATCH', body }),
    onSuccess: (admin) => {
      client.setQueryData(ADMIN_KEY, admin)
      client.setQueryData<Me | null>(ME_KEY, (me) => me && { ...me, publicUrl: admin.publicUrl })
      navigate('/admin')
    },
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
