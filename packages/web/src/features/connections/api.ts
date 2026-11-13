import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@jakebox/common/api.ts'
import { Connection, ConnectionEvent, type CreateConnection, type UpdateConnection } from '@jakebox/common/connections/connection.ts'
import { request } from '@/lib/api-client'
import { CONNECTIONS_KEY, GRANTS_KEY } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const CONNECTION_LIST = List(Connection)
const EVENT_LIST = List(ConnectionEvent)
const DELETED_CONNECTION = Deleted('connection')
const EVENTS_PER_PAGE = '25'

export function useConnections() {
  return useQuery({ queryKey: CONNECTIONS_KEY, queryFn: () => request({ schema: CONNECTION_LIST, path: '/api/connections' }).then((page) => page.data) })
}

export function useConnection(connectionId: string) {
  return useQuery({ queryKey: [...CONNECTIONS_KEY, connectionId], queryFn: () => request({ schema: Connection, path: connectionPath(connectionId) }) })
}

export function useConnectionEvents(connectionId: string) {
  return useInfiniteQuery({
    queryKey: ['connection-events', connectionId],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ connectionId, limit: EVENTS_PER_PAGE })
      if (pageParam) params.set('startingAfter', pageParam)
      return request({ schema: EVENT_LIST, path: `/api/connection-events?${params}` })
    },
    getNextPageParam: (page) => page.hasMore ? page.data.at(-1)?.id : undefined,
    retry: false,
  })
}

export function useCreateConnection() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateConnection) => request({ schema: Connection, path: '/api/connections', method: 'POST', body }),
    onSuccess: (connection) => {
      client.setQueryData<Connection[]>(CONNECTIONS_KEY, (connections) => connections && [...connections, connection])
      navigate('/connections')
    },
  })
}

export function useUpdateConnection(connectionId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateConnection) => request({ schema: Connection, path: connectionPath(connectionId), method: 'PATCH', body }),
    onSuccess: (connection) => {
      client.setQueryData([...CONNECTIONS_KEY, connectionId], connection)
      client.setQueryData<Connection[]>(CONNECTIONS_KEY, (connections) => connections?.map((each) => each.id === connectionId ? connection : each))
    },
  })
}

export function useDeleteConnection(connectionId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: DELETED_CONNECTION, path: connectionPath(connectionId), method: 'DELETE' }),
    onSuccess: () => {
      navigate('/connections')
      client.removeQueries({ queryKey: [...CONNECTIONS_KEY, connectionId] })
      client.setQueryData<Connection[]>(CONNECTIONS_KEY, (connections) => connections?.filter((each) => each.id !== connectionId))
      void client.invalidateQueries({ queryKey: GRANTS_KEY })
    },
  })
}

function connectionPath(connectionId: string) {
  return `/api/connections/${encodeURIComponent(connectionId)}`
}
