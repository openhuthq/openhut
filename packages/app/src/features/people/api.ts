import { useQuery } from '@tanstack/react-query'
import { openhut } from '@/lib/openhut'
import { ME_KEY } from '@/lib/query-keys'

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => openhut.account.me(), retry: (count) => count < 3 })
}

export function useOwner(): string {
  return useMe().data?.user.email ?? ''
}
