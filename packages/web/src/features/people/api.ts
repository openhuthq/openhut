import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { Invite, Person, type MemberRole } from '@openhut/common/team/team.ts'
import { request } from '@/lib/api-client'
import { AGENTS_KEY } from '@/lib/query-keys'

const PEOPLE_KEY = ['people']
const INVITES_KEY = ['invites']
const PERSON_LIST = List(Person)
const INVITE_LIST = List(Invite)
const DELETED_PERSON = Deleted('person')
const DELETED_INVITE = Deleted('invite')

export function usePeople() {
  return useQuery({ queryKey: PEOPLE_KEY, queryFn: () => request({ schema: PERSON_LIST, path: '/api/people' }).then((page) => page.data) })
}

export function useInvites(enabled: boolean) {
  return useQuery({ queryKey: INVITES_KEY, enabled, queryFn: () => request({ schema: INVITE_LIST, path: '/api/invites' }).then((page) => page.data) })
}

export function useDeletePerson() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (personId: string) => request({ schema: DELETED_PERSON, path: `/api/people/${encodeURIComponent(personId)}`, method: 'DELETE' }),
    onSuccess: (deleted) => {
      client.setQueryData<Person[]>(PEOPLE_KEY, (people) => people?.filter((person) => person.id !== deleted.id))
      void client.invalidateQueries({ queryKey: INVITES_KEY })
      void client.invalidateQueries({ queryKey: AGENTS_KEY })
    },
  })
}

export function useCreateInvite() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (role: MemberRole) => request({ schema: Invite, path: '/api/invites', method: 'POST', body: { role } }),
    onSuccess: (invite) => {
      client.setQueryData<Invite[]>(INVITES_KEY, (invites) => invites && [...invites, invite])
    },
  })
}

export function useDeleteInvite() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (inviteId: string) => request({ schema: DELETED_INVITE, path: `/api/invites/${encodeURIComponent(inviteId)}`, method: 'DELETE' }),
    onSuccess: (deleted) => client.setQueryData<Invite[]>(INVITES_KEY, (invites) => invites?.filter((invite) => invite.id !== deleted.id)),
  })
}
