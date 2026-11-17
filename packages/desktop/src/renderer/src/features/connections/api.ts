import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { type Connection, ConnectionAuthorization, ConnectionEvent, ConnectionTool, type CreateConnection, type CreateConnectionAuthorization } from '@openhut/common/connections/connection.ts'
import type { OpenHutConnection } from '@openhut/client'
import { request } from '@/lib/api-client'
import { at, onComputer, openhut, rememberHomes } from '@/lib/openhut'
import { CONNECTIONS_KEY, GRANTS_KEY } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const EVENT_LIST = List(ConnectionEvent)
const TOOL_LIST = List(ConnectionTool)
const DELETED_CONNECTION = Deleted('connection')
const EVENTS_PER_PAGE = '25'

export function useConnections() {
  return useQuery({ queryKey: CONNECTIONS_KEY, queryFn: () => openhut.connections.list().then((connections) => { rememberHomes(connections.flatMap((connection) => connection.computers.map((copy) => ({ id: copy.id, computer: copy.computer })))); return connections }) })
}

export function useAddConnectionTo() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; computer: string }) => openhut.connections.addTo(input),
    onSuccess: () => client.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  })
}


export function useConnectionEvents(connection: OpenHutConnection) {
  return useQueries({
    queries: connection.computers.map(({ id }) => ({
      queryKey: ['connection-events', id],
      queryFn: () => request({ schema: EVENT_LIST, path: at({ id, path: `/api/connection-events?${new URLSearchParams({ connectionId: id, limit: EVENTS_PER_PAGE })}` }) }).then((page) => page.data),
      retry: false,
    })),
    combine: (results) => ({ data: results.some((result) => result.data) ? results.flatMap((result) => result.data ?? []).sort((a, b) => b.at.localeCompare(a.at)) : undefined, error: results.find((result) => result.error)?.error ?? null }),
  })
}

export function useCreateConnection() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ computers = [], ...body }: CreateConnection & { computers?: string[] }) => {
      const order = [...(computers.length ? computers : ['local'])].sort((a, b) => Number(b === 'local') - Number(a === 'local'))
      const made: { computer: string; connection: Connection }[] = []
      try {
        for (const computer of order) made.push({ computer, connection: await openhut.connections.connect({ ...body, computer }) })
      } catch (error) {
        await Promise.allSettled(made.map(({ computer, connection }) => request({ schema: DELETED_CONNECTION, path: onComputer({ computer, path: `/api/connections/${encodeURIComponent(connection.id)}` }), method: 'DELETE' })))
        throw error
      }
      return made[0].connection
    },
    onSuccess: (connection) => {
      void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
      client.setQueryData([...CONNECTIONS_KEY, connection.id], connection)
      navigate(`/connections/${connection.id}?connected=1`, true)
    },
  })
}

export function useAuthorizeConnection() {
  return useMutation({
    mutationFn: (body: CreateConnectionAuthorization) => request({ schema: ConnectionAuthorization, path: body.connectionId ? at({ id: body.connectionId, path: '/api/connection-authorizations' }) : '/api/connection-authorizations', method: 'POST', body }),
    onSuccess: (authorization) => {
      if (!authorization.manifest) return location.assign(authorization.authorizationUrl)
      const form = Object.assign(document.createElement('form'), { method: 'post', action: authorization.authorizationUrl })
      form.append(Object.assign(document.createElement('input'), { type: 'hidden', name: 'manifest', value: authorization.manifest }))
      document.body.append(form)
      form.submit()
    },
  })
}

export function useConnectionTools(connection: OpenHutConnection) {
  const connectionId = (connection.computers.find((copy) => copy.online) ?? connection.computers[0]).id
  return useQuery({
    queryKey: ['connection-tools', connectionId],
    queryFn: () => request({ schema: TOOL_LIST, path: at({ id: connectionId, path: `/api/connection-tools?${new URLSearchParams({ connectionId })}` }) }).then((page) => page.data),
    retry: false,
  })
}

export function useDeleteConnection(connection: OpenHutConnection) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => Promise.all(connection.computers.map(({ id }) => request({ schema: DELETED_CONNECTION, path: connectionPath(id), method: 'DELETE' }))),
    onSuccess: () => {
      navigate('/connections')
      client.setQueryData<OpenHutConnection[]>(CONNECTIONS_KEY, (connections) => connections?.filter((each) => each.id !== connection.id))
      void client.invalidateQueries({ queryKey: GRANTS_KEY })
    },
  })
}

function connectionPath(connectionId: string) {
  return at({ id: connectionId, path: `/api/connections/${encodeURIComponent(connectionId)}` })
}
