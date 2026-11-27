import { useQuery } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import { Provider } from '@openhut/common/models/provider.ts'
import { request } from '@/lib/api-client'
import { PROVIDERS_KEY } from '@/lib/query-keys'

const PROVIDER_LIST = List(Provider)

export function useProviders() {
  return useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => request({ schema: PROVIDER_LIST, path: '/api/providers' }).then((page) => page.data) })
}

export function useComputerProviders(_computer: string): Provider[] | undefined {
  return useProviders().data
}
