import { useQuery } from '@tanstack/react-query'
import { Me } from '@openhut/common/team/team.ts'
import { request } from '@/lib/api-client'
import { ME_KEY } from '@/lib/query-keys'

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => request({ schema: Me, computer: 'local', path: '/api/me' }) })
}
