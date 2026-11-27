import { queryOptions } from '@tanstack/react-query'
import { adminOf } from '@/lib/queries/computers'
import { UPDATES_KEY } from '@/lib/query-keys'

export const POLL_MS = 3000

export const updatesQuery = queryOptions({ queryKey: UPDATES_KEY, queryFn: adminOf, refetchInterval: (query) => query.state.data?.server.update?.status === 'running' ? POLL_MS : false })
