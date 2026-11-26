import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { AgentTool, Connection, ConnectionAuthorization, ConnectionEvent, ConnectionTool, type UpdateAgentTools, type CreateConnection, type CreateConnectionAuthorization, type ReconnectConnection } from '@openhut/common/connections/connection.ts'
import { request, RequestError } from '@/lib/api-client'
import { CONNECTIONS_KEY, GRANTS_KEY } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const CONNECTION_LIST = List(Connection)
const EVENT_LIST = List(ConnectionEvent)
const TOOL_LIST = List(ConnectionTool)
const AGENT_TOOL_LIST = List(AgentTool)
const DELETED_CONNECTION = Deleted('connection')
const EVENTS_PER_PAGE = '25'

export function useConnections() {
  return useQuery({ queryKey: CONNECTIONS_KEY, queryFn: () => request({ schema: CONNECTION_LIST, path: '/api/connections' }).then((page) => page.data) })
}

export function useReconnect(connection: Connection) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: ReconnectConnection) => request({ schema: Connection, path: `/api/connections/${encodeURIComponent(connection.id)}`, method: 'PATCH', body }),
    onSuccess: () => Promise.all([CONNECTIONS_KEY, ['connection-tools', connection.id]].map((queryKey) => client.invalidateQueries({ queryKey }))),
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
const CLOSED_GRACE_MS = 4000

export function openSignInTab(): Window | null {
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  return tab
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function useAuthorizeConnection({ stay = false }: { stay?: boolean } = {}) {
  const client = useQueryClient()
  const live = useRef(true)
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])
  const mutation = useMutation({
    mutationFn: async ({ tab, ...body }: CreateConnectionAuthorization & { tab: Window | null }) => {
      const started = await request({ schema: ConnectionAuthorization, path: '/api/connection-authorizations', method: 'POST', body }).catch((err: unknown) => {
        tab?.close()
        throw err
      })
      setUrl(started.authorizationUrl)
      if (tab && !tab.closed) tab.location.href = started.authorizationUrl
      else window.open(started.authorizationUrl, '_blank', 'noopener')
      let closedAt: number | undefined
      for (let waited = 0; live.current && waited < SIGN_IN_WAIT_MS; waited += SIGN_IN_POLL_MS) {
        await sleep(SIGN_IN_POLL_MS)
        const now = await request({ schema: ConnectionAuthorization, path: `/api/connection-authorizations/${encodeURIComponent(started.id)}` }).catch((err: unknown) => {
          if (err instanceof RequestError && err.status < 500) throw err
          return undefined
        })
        if (now?.status === 'failed') throw new Error(now.error ?? 'The sign-in didn’t finish. Try again.')
        if (now?.status === 'done') return now
        if (tab?.closed) closedAt ??= Date.now()
        if (closedAt && Date.now() - closedAt > CLOSED_GRACE_MS) throw new Error('The sign-in tab was closed before it finished. Sign in again.')
      }
      return null
    },
    onSuccess: (done) => {
      if (!done?.connectionId) return
      void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
      if (stay) return
      navigate(`/connections/${done.connectionId}?connected=1`, true)
    },
  })
  return { ...mutation, url }
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

const agentToolsKey = ({ agentId, connectionId }: { agentId: string; connectionId: string }) => ['agent-tools', agentId, connectionId]

export function useAgentTools(filter: { agentId: string; connectionId: string }) {
  return useQuery({ queryKey: agentToolsKey(filter), queryFn: () => request({ schema: AGENT_TOOL_LIST, of: filter.agentId, path: `/api/agent-tools?${new URLSearchParams(filter)}` }).then((page) => page.data) })
}

export function useSetToolPermission() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAgentTools) => request({ schema: AGENT_TOOL_LIST, of: body.agentId, path: '/api/agent-tools', method: 'PATCH', body }).then((page) => page.data),
    onSuccess: (tools, body) => client.setQueryData<AgentTool[]>(agentToolsKey(body), tools),
  })
}

export function useResetToolPermissions(filter: { agentId: string; connectionId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: AGENT_TOOL_LIST, of: filter.agentId, path: `/api/agent-tools?${new URLSearchParams(filter)}`, method: 'DELETE' }).then((page) => page.data),
    onSuccess: (tools) => client.setQueryData(agentToolsKey(filter), tools),
  })
}

export function useAgentEvents(agentId: string) {
  return useQuery({
    queryKey: ['agent-events', agentId],
    queryFn: () => request({ schema: EVENT_LIST, of: agentId, path: `/api/connection-events?${new URLSearchParams({ agentId, limit: EVENTS_PER_PAGE })}` }).then((page) => page.data),
  })
}
