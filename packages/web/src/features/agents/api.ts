import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@jakebox/common/api.ts'
import { Agent, Grant, type CreateAgent, type UpdateAgent } from '@jakebox/common/agents/agent.ts'
import { Channel, type CreateChannel, type UpdateChannel } from '@jakebox/common/channels/channel.ts'
import { Connection } from '@jakebox/common/connections/connection.ts'
import { request } from '@/lib/api-client'
import { AGENTS_KEY, CONNECTIONS_KEY, GRANTS_KEY, grantsKey } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const AGENT_LIST = List(Agent)
const CONNECTION_LIST = List(Connection)
const GRANT_LIST = List(Grant)
const CHANNEL_LIST = List(Channel)
const DELETED_AGENT = Deleted('agent')
const DELETED_GRANT = Deleted('grant')
const DELETED_CHANNEL = Deleted('channel')

export function useAgents() {
  return useQuery({ queryKey: AGENTS_KEY, queryFn: () => request({ schema: AGENT_LIST, path: '/api/agents' }).then((page) => page.data) })
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: [...AGENTS_KEY, agentId],
    queryFn: () => request({ schema: Agent, path: agentPath(agentId) }),
    refetchInterval: (query) => settling(query.state.data) ? 3_000 : false,
  })
}

export function useCreateAgent() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAgent) => request({ schema: Agent, path: '/api/agents', method: 'POST', body }),
    onSuccess: (agent) => {
      client.setQueryData([...AGENTS_KEY, agent.id], agent)
      client.setQueryData<Agent[]>(AGENTS_KEY, (agents) => agents && [...agents, agent])
      navigate(`/agents/${agent.id}`)
    },
  })
}

export function useUpdateAgent(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAgent) => request({ schema: Agent, path: agentPath(agentId), method: 'PATCH', body }),
    onSuccess: (agent) => {
      client.setQueryData([...AGENTS_KEY, agent.id], agent)
      client.setQueryData<Agent[]>(AGENTS_KEY, (agents) => agents?.map((each) => each.id === agent.id ? agent : each))
    },
  })
}

export function useDeleteAgent(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: DELETED_AGENT, path: agentPath(agentId), method: 'DELETE' }),
    onSuccess: () => {
      navigate('/agents')
      client.removeQueries({ queryKey: [...AGENTS_KEY, agentId] })
      client.setQueryData<Agent[]>(AGENTS_KEY, (agents) => agents?.filter((agent) => agent.id !== agentId))
      void client.invalidateQueries({ queryKey: GRANTS_KEY })
      void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
    },
  })
}

export function useConnections() {
  return useQuery({ queryKey: CONNECTIONS_KEY, queryFn: () => request({ schema: CONNECTION_LIST, path: '/api/connections' }).then((page) => page.data) })
}

export function useGrants(agentId: string) {
  return useQuery({ queryKey: grantsKey({ agentId }), queryFn: () => request({ schema: GRANT_LIST, path: `/api/grants?${new URLSearchParams({ agentId })}` }).then((page) => page.data) })
}

export function useCreateGrant() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { agentId: string; connectionId: string }) => request({ schema: Grant, path: '/api/grants', method: 'POST', body }),
    onSuccess: (grant) => writeGrant(client, grant, (grants) => [...grants, grant]),
  })
}

export function useDeleteGrant() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (grant: Grant) => request({ schema: DELETED_GRANT, path: `/api/grants/${encodeURIComponent(grant.id)}`, method: 'DELETE' }),
    onSuccess: (_, grant) => writeGrant(client, grant, (grants) => grants.filter((each) => each.id !== grant.id)),
  })
}

export function useChannels(agentId: string) {
  return useQuery({
    queryKey: channelsKey(agentId),
    queryFn: async () => {
      const page = await request({ schema: CHANNEL_LIST, path: `/api/channels?${new URLSearchParams({ agentId })}` })
      return Promise.all(page.data.map((channel) => channel.status === 'linking' ? request({ schema: Channel, path: channelPath(channel.id) }) : channel))
    },
    refetchInterval: (query) => query.state.data?.some((channel) => channel.status === 'linking') ? 3_000 : false,
  })
}

export function useCreateChannel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateChannel) => request({ schema: Channel, path: '/api/channels', method: 'POST', body }),
    onSuccess: (channel) => writeChannel(client, channel),
  })
}

export function useUpdateChannel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ channelId, change }: { channelId: string; change: UpdateChannel }) => request({ schema: Channel, path: channelPath(channelId), method: 'PATCH', body: change }),
    onSuccess: (channel) => writeChannel(client, channel),
  })
}

export function useDeleteChannel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (channel: Channel) => request({ schema: DELETED_CHANNEL, path: channelPath(channel.id), method: 'DELETE' }),
    onSuccess: (_, channel) => client.setQueryData<Channel[]>(channelsKey(channel.agentId), (channels) => channels?.filter((each) => each.id !== channel.id)),
  })
}

function agentPath(agentId: string) {
  return `/api/agents/${encodeURIComponent(agentId)}`
}

function channelPath(channelId: string) {
  return `/api/channels/${encodeURIComponent(channelId)}`
}

function channelsKey(agentId: string) {
  return ['channels', agentId]
}

function settling(agent: Agent | undefined) {
  return !!agent && (agent.wanted === 'running') !== (agent.status === 'running')
}

function writeGrant(client: QueryClient, grant: Grant, change: (grants: Grant[]) => Grant[]) {
  client.setQueryData<Grant[]>(grantsKey({ agentId: grant.agentId }), (grants) => grants && change(grants))
  client.setQueryData<Grant[]>(grantsKey({ connectionId: grant.connectionId }), (grants) => grants && change(grants))
  return client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
}

function writeChannel(client: QueryClient, channel: Channel) {
  client.setQueryData<Channel[]>(channelsKey(channel.agentId), (channels) => channels && [...channels.filter((each) => each.kind !== channel.kind), channel])
}
