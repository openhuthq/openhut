import { useQuery } from '@tanstack/react-query'
import { UnlockCanceled } from '@/lib/native'
import { openhut } from '@/lib/openhut'
import { ME_KEY } from '@/lib/query-keys'

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => openhut.account.me(), retry: (count, error) => !(error instanceof UnlockCanceled) && count < 3 })
}
