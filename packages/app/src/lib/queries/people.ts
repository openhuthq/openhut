import { useQuery } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import { Person } from '@openhut/common/team/team.ts'
import { request, RequestError } from '@/lib/api-client'
import { openhut } from '@/lib/openhut'
import { ME_KEY, PEOPLE_KEY } from '@/lib/query-keys'

const People = List(Person)

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

export function usePeople() {
  return useQuery({ queryKey: PEOPLE_KEY, queryFn: async () => (await request({ schema: People, path: '/api/people' })).data })
}
