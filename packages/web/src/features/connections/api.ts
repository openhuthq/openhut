import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@fastmonkey/common/api.ts'
import { Connection, ConnectionAuthorization, ConnectionEvent, ConnectionTool, Tailscale, type ConnectTailscale, type CreateConnection, type CreateConnectionAuthorization, type UpdateConnection } from '@fastmonkey/common/connections/connection.ts'
import { request } from '@/lib/api-client'
import { CONNECTIONS_KEY, GRANTS_KEY } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const CONNECTION_LIST = List(Connection)
const EVENT_LIST = List(ConnectionEvent)
const TOOL_LIST = List(ConnectionTool)
const TAILSCALE_KEY = ['tailscale']
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
      client.setQueryData([...CONNECTIONS_KEY, connection.id], connection)
      navigate(`/connections/${connection.id}?connected=1`, true)
    },
  })
}

export function useAuthorizeConnection() {
  return useMutation({
    mutationFn: (body: CreateConnectionAuthorization) => request({ schema: ConnectionAuthorization, path: '/api/connection-authorizations', method: 'POST', body }),
    onSuccess: (authorization) => {
      if (!authorization.manifest) return location.assign(authorization.authorizationUrl)
      const form = Object.assign(document.createElement('form'), { method: 'post', action: authorization.authorizationUrl })
      form.append(Object.assign(document.createElement('input'), { type: 'hidden', name: 'manifest', value: authorization.manifest }))
      document.body.append(form)
      form.submit()
    },
  })
}

export function useConnectionTools(connectionId: string) {
  return useQuery({
    queryKey: ['connection-tools', connectionId],
    queryFn: () => request({ schema: TOOL_LIST, path: `/api/connection-tools?${new URLSearchParams({ connectionId })}` }).then((page) => page.data),
    retry: false,
  })
}

export function useTailscale() {
  return useQuery({ queryKey: TAILSCALE_KEY, queryFn: () => request({ schema: Tailscale, path: '/api/tailscale' }) })
}

export function useConnectTailscale() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: ConnectTailscale) => request({ schema: Tailscale, path: '/api/tailscale', method: 'PUT', body }),
    onSuccess: (tailscale) => {
      client.setQueryData(TAILSCALE_KEY, tailscale)
      navigate('/connections/tailscale', true)
    },
  })
}

export function useDisconnectTailscale() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: Tailscale, path: '/api/tailscale', method: 'DELETE' }),
    onSuccess: (tailscale) => {
      client.setQueryData(TAILSCALE_KEY, tailscale)
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
