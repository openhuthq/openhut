import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { List } from '@openhut/common/api.ts'
import { Invite, Person, type MemberRole } from '@openhut/common/team/team.ts'
import { request, RequestError } from '@/lib/api-client'
import { openhut } from '@/lib/openhut'
import { ME_KEY } from '@/lib/query-keys'

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => openhut.account.me(), retry: (count, error) => count < 3 && !(error instanceof RequestError && error.status === 401) })
}

export function useOwner(): string {
  return useMe().data?.user.email ?? ''
}

export function useIsAdmin(): boolean {
  const role = useMe().data?.user.role
  return role === 'owner' || role === 'admin'
}

const Deleted = z.object({ id: z.string(), deleted: z.boolean() })
const PEOPLE_KEY = ['people']
const People = List(Person)

export function usePeople() {
  return useQuery({ queryKey: PEOPLE_KEY, queryFn: async () => (await request({ schema: People, path: '/api/people' })).data })
}

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

export function useCreateInvite() {
  return useMutation({ mutationFn: ({ role }: { role: MemberRole }) => request({ schema: Invite, path: '/api/invites', method: 'POST', body: { role } }) })
}
