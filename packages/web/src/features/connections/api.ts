import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@jakebox/common/api.ts'
import { Agent, Grant } from '@jakebox/common/agents/agent.ts'
import { Connection, ConnectionEvent, type CreateConnection, type UpdateConnection } from '@jakebox/common/connections/connection.ts'
import { request } from '@/lib/api-client'
import { AGENTS_KEY, CONNECTIONS_KEY, GRANTS_KEY, grantsKey } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const CONNECTION_LIST = List(Connection)
const EVENT_LIST = List(ConnectionEvent)
const AGENT_LIST = List(Agent)
const GRANT_LIST = List(Grant)
const DELETED_CONNECTION = Deleted('connection')
const DELETED_GRANT = Deleted('grant')
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

export function useAgents() {
  return useQuery({ queryKey: AGENTS_KEY, queryFn: () => request({ schema: AGENT_LIST, path: '/api/agents' }).then((page) => page.data) })
}

export function useGrants(connectionId: string) {
  return useQuery({ queryKey: grantsKey({ connectionId }), queryFn: () => request({ schema: GRANT_LIST, path: `/api/grants?${new URLSearchParams({ connectionId })}` }).then((page) => page.data) })
}

export function useDeleteGrant() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (grant: Grant) => request({ schema: DELETED_GRANT, path: `/api/grants/${encodeURIComponent(grant.id)}`, method: 'DELETE' }),
    onSuccess: (_, grant) => {
      const remove = (grants: Grant[] | undefined) => grants?.filter((each) => each.id !== grant.id)
      client.setQueryData<Grant[]>(grantsKey({ connectionId: grant.connectionId }), remove)
      client.setQueryData<Grant[]>(grantsKey({ agentId: grant.agentId }), remove)
      return client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
    },
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
