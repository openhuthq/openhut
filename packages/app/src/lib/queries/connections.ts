import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import { AgentTool, Connection, ConnectionEvent, ConnectionTool, type UpdateAgentTools } from '@openhut/common/connections/connection.ts'
import { request } from '@/lib/api-client'
import { agentConnectionToolsKey, agentEventsKey, CONNECTIONS_KEY, connectionToolsKey } from '@/lib/query-keys'

const CONNECTION_LIST = List(Connection)
const EVENT_LIST = List(ConnectionEvent)
const TOOL_LIST = List(ConnectionTool)
const AGENT_TOOL_LIST = List(AgentTool)
const EVENTS_PER_PAGE = '25'

export function useConnections() {
  return useQuery({ queryKey: CONNECTIONS_KEY, queryFn: () => request({ schema: CONNECTION_LIST, path: '/api/connections' }).then((page) => page.data) })
}

export function useConnectionTools(connection: Connection) {
  return useQuery({
    queryKey: connectionToolsKey(connection.id),
    queryFn: () => request({ schema: TOOL_LIST, path: `/api/connection-tools?${new URLSearchParams({ connectionId: connection.id })}` }).then((page) => page.data),
    retry: false,
  })
}

export function useAgentTools(filter: { agentId: string; connectionId: string }) {
  return useQuery({ queryKey: agentConnectionToolsKey(filter), queryFn: () => request({ schema: AGENT_TOOL_LIST, of: filter.agentId, path: `/api/agent-tools?${new URLSearchParams(filter)}` }).then((page) => page.data) })
}

export function useSetToolPermission() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAgentTools) => request({ schema: AGENT_TOOL_LIST, of: body.agentId, path: '/api/agent-tools', method: 'PATCH', body }).then((page) => page.data),
    onSuccess: (tools, body) => client.setQueryData<AgentTool[]>(agentConnectionToolsKey(body), tools),
  })
}

export function useResetToolPermissions(filter: { agentId: string; connectionId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: AGENT_TOOL_LIST, of: filter.agentId, path: `/api/agent-tools?${new URLSearchParams(filter)}`, method: 'DELETE' }).then((page) => page.data),
    onSuccess: (tools) => client.setQueryData(agentConnectionToolsKey(filter), tools),
  })
}

export function useAgentEvents(agentId: string) {
  return useQuery({
    queryKey: agentEventsKey(agentId),
    queryFn: () => request({ schema: EVENT_LIST, of: agentId, path: `/api/connection-events?${new URLSearchParams({ agentId, limit: EVENTS_PER_PAGE })}` }).then((page) => page.data),
  })
}
