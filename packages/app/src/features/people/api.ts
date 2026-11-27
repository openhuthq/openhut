import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { List } from '@openhut/common/api.ts'
import { Invite, Person, type MemberRole } from '@openhut/common/team/team.ts'
import { request } from '@/lib/api-client'
import { INVITES_KEY, PEOPLE_KEY } from '@/lib/query-keys'

const Deleted = z.object({ id: z.string(), deleted: z.boolean() })

export function useSetRole() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: MemberRole }) => request({ schema: Person, path: `/api/people/${id}`, method: 'PATCH', body: { role } }),
    onSuccess: () => client.invalidateQueries({ queryKey: PEOPLE_KEY }),
  })
}

export function useRemovePerson() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) => request({ schema: Deleted, path: `/api/people/${id}`, method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: PEOPLE_KEY }),
  })
}

const Invites = List(Invite)

export function useInvites({ enabled }: { enabled: boolean }) {
  return useQuery({ queryKey: INVITES_KEY, enabled, queryFn: async () => (await request({ schema: Invites, path: '/api/invites' })).data })
}

export function useCreateInvite() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ role }: { role: MemberRole }) => request({ schema: Invite, path: '/api/invites', method: 'POST', body: { role } }),
    onSuccess: () => client.invalidateQueries({ queryKey: INVITES_KEY }),
  })
}

export function useRevokeInvite() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) => request({ schema: Deleted, path: `/api/invites/${id}`, method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: INVITES_KEY }),
  })
}
