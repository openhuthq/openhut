import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { Connection, ConnectionAuthorization, ConnectionEvent, ConnectionTool, type CreateConnection, type CreateConnectionAuthorization } from '@openhut/common/connections/connection.ts'
import { request } from '@/lib/api-client'
import { AGENTS_KEY, CONNECTIONS_KEY, GRANTS_KEY } from '@/lib/query-keys'
import { asked } from '@/features/connections/asked'
import { isPhone } from '@/lib/native'
import { navigate } from '@/lib/router'

const CONNECTION_LIST = List(Connection)
const EVENT_LIST = List(ConnectionEvent)
const TOOL_LIST = List(ConnectionTool)
const DELETED_CONNECTION = Deleted('connection')
const EVENTS_PER_PAGE = '25'

export function useConnections() {
  return useQuery({ queryKey: CONNECTIONS_KEY, queryFn: () => request({ schema: CONNECTION_LIST, path: '/api/connections' }).then((page) => page.data) })
}

export function useConnectionEvents(connection: Connection) {
  return useQuery({
    queryKey: ['connection-events', connection.id],
    queryFn: () => request({ schema: EVENT_LIST, path: `/api/connection-events?${new URLSearchParams({ connectionId: connection.id, limit: EVENTS_PER_PAGE })}` }).then((page) => page.data),
    retry: false,
  })
}

export function useCreateConnection() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateConnection) => request({ schema: Connection, path: '/api/connections', method: 'POST', body }),
    onSuccess: (connection) => {
      void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
      client.setQueryData([...CONNECTIONS_KEY, connection.id], connection)
      navigate(`/connections/${connection.id}?connected=1`, true)
    },
  })
}

const SIGN_IN_POLL_MS = 1500
const SIGN_IN_WAIT_MS = 15 * 60_000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function useAuthorizeConnection() {
  const client = useQueryClient()
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])
  return useMutation({
    mutationFn: async (body: CreateConnectionAuthorization) => {
      if (isPhone()) throw new Error('Sign-ins finish on your Mac, so connect this app from OpenHut there. Agents on your phone can use it right after.')
      const started = await request({ schema: ConnectionAuthorization, path: '/api/connection-authorizations', method: 'POST', body })
      window.open(started.authorizationUrl, '_blank', 'noopener')
      for (let waited = 0; live.current && waited < SIGN_IN_WAIT_MS; waited += SIGN_IN_POLL_MS) {
        await sleep(SIGN_IN_POLL_MS)
        const now = await request({ schema: ConnectionAuthorization, path: `/api/connection-authorizations/${encodeURIComponent(started.id)}` })
        if (now.status === 'failed') throw new Error(now.error ?? 'The sign-in didn’t finish. Try again.')
        if (now.status === 'done') return now
      }
      return null
    },
    onSuccess: (done) => {
      if (!done?.connectionId) return
      void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
      navigate(`/connections/${done.connectionId}?connected=1`, true)
    },
  })
}

export function useConnectionTools(connection: Connection) {
  return useQuery({
    queryKey: ['connection-tools', connection.id],
    queryFn: () => request({ schema: TOOL_LIST, path: `/api/connection-tools?${new URLSearchParams({ connectionId: connection.id })}` }).then((page) => page.data),
    retry: false,
  })
}

export function useDeleteConnection(connection: Connection) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: DELETED_CONNECTION, path: `/api/connections/${encodeURIComponent(connection.id)}`, method: 'DELETE' }),
    onSuccess: () => {
      navigate('/connections')
      client.setQueryData<Connection[]>(CONNECTIONS_KEY, (connections) => connections?.filter((each) => each.id !== connection.id))
      void client.invalidateQueries({ queryKey: GRANTS_KEY })
    },
  })
}

export function useBackToAsker() {
  const client = useQueryClient()
  return async ({ agentId, name }: { agentId: string; name: string }) => {
    asked.done({ agentId, line: `Connected ${name}.` })
    await client.invalidateQueries({ queryKey: AGENTS_KEY })
    navigate(`/agents/${encodeURIComponent(agentId)}`)
  }
}
