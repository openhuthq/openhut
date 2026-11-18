import { useEffect, useState } from 'react'
import { useMutation, useMutationState, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { Agent, Grant, type CreateAgent, type UpdateAgent } from '@openhut/common/agents/agent.ts'
import { Memory, type UpdateMemory } from '@openhut/common/agents/memory.ts'
import { Skill } from '@openhut/common/agents/skill.ts'
import { Channel, Conversation, type CreateChannel, type UpdateChannel } from '@openhut/common/channels/channel.ts'
import type { OpenHutAgent } from '@openhut/client'
import { request } from '@/lib/api-client'
import { at, on, openhut, rememberHomes } from '@/lib/openhut'
import { AGENTS_KEY, CONNECTIONS_KEY, GRANTS_KEY, grantsKey } from '@/lib/query-keys'
import { navigate } from '@/lib/router'
import { saveLook } from '@/features/agents/face'
import type { Look } from '@/lib/face'

const GRANT_LIST = List(Grant)
const CHANNEL_LIST = List(Channel)
const CONVERSATION_LIST = List(Conversation)
const SKILL_LIST = List(Skill)
const DELETED_AGENT = Deleted('agent')
const DELETED_GRANT = Deleted('grant')
const DELETED_CHANNEL = Deleted('channel')
const DELETED_SKILL = Deleted('skill')

export function useAgents() {
  return useQuery({ queryKey: AGENTS_KEY, queryFn: () => openhut.agents.list().then((agents) => { rememberHomes(agents); return agents }) })
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
    mutationFn: async ({ body, look }: { body: CreateAgent; look: Look }) => {
      const agent = await request({ schema: Agent, path: '/api/agents', method: 'POST', body })
      saveLook({ agentId: agent.id, look })
      return request({ schema: Agent, path: agentPath(agent.id), method: 'PATCH', body: { wanted: 'running' } })
    },
    onSuccess: (agent) => {
      client.setQueryData([...AGENTS_KEY, agent.id], agent)
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents && [...agents, { ...agent, computer: 'local', online: true }])
      navigate(`/agents/${encodeURIComponent(agent.id)}`)
    },
  })
}

const RESTARTS = ['instructions', 'model', 'fallbackModel', 'helperModels', 'codeExecution', 'browser'] as const
const RESTART_SHOWN_MS = 1800

export function useRestarting(agentId: string) {
  const pending = useMutationState({ filters: { mutationKey: ['agent-update', agentId], status: 'pending' }, select: (mutation) => mutation.state.variables }).some((variables) => typeof variables === 'object' && variables !== null && RESTARTS.some((field) => field in variables))
  const [lingering, setLingering] = useState(false)
  useEffect(() => {
    if (pending) return setLingering(true)
    const timer = setTimeout(() => setLingering(false), RESTART_SHOWN_MS)
    return () => clearTimeout(timer)
  }, [pending])
  return pending || lingering
}

export function useUpdateAgent(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['agent-update', agentId],
    mutationFn: (body: UpdateAgent) => request({ schema: Agent, path: agentPath(agentId), method: 'PATCH', body }),
    onSuccess: (agent) => {
      client.setQueryData([...AGENTS_KEY, agent.id], agent)
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents?.map((each) => each.id === agent.id ? { ...each, ...agent } : each))
    },
  })
}

export function useDeleteAgent(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: DELETED_AGENT, path: agentPath(agentId), method: 'DELETE' }),
    onSuccess: () => {
      navigate('/')
      client.removeQueries({ queryKey: [...AGENTS_KEY, agentId] })
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents?.filter((agent) => agent.id !== agentId))
      void client.invalidateQueries({ queryKey: GRANTS_KEY })
      void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
    },
  })
}

export function useGrants(filter: { agentId: string } | { connectionId: string }) {
  return useQuery({ queryKey: grantsKey(filter), queryFn: () => request({ schema: GRANT_LIST, path: at({ id: 'agentId' in filter ? filter.agentId : filter.connectionId, path: `/api/grants?${new URLSearchParams(filter)}` }) }).then((page) => page.data) })
}

export function useConnectionGrants(connection: { computers: { id: string }[] }) {
  return useQueries({
    queries: connection.computers.map(({ id }) => ({ queryKey: grantsKey({ connectionId: id }), queryFn: () => request({ schema: GRANT_LIST, path: at({ id, path: `/api/grants?${new URLSearchParams({ connectionId: id })}` }) }).then((page) => page.data) })),
    combine: (results) => ({ data: results.every((result) => result.data) ? results.flatMap((result) => result.data ?? []) : undefined }),
  })
}

export function useCreateGrant() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { agentId: string; connectionId: string }) => openhut.connections.grant({ agent: body.agentId, connection: body.connectionId }),
    onSuccess: (grant) => writeGrant(client, grant, (grants) => [...grants, grant]),
  })
}

export function useDeleteGrant() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (grant: Grant) => request({ schema: DELETED_GRANT, path: on({ agentId: grant.agentId, path: `/api/grants/${encodeURIComponent(grant.id)}` }), method: 'DELETE' }),
    onSuccess: (_, grant) => writeGrant(client, grant, (grants) => grants.filter((each) => each.id !== grant.id)),
  })
}

export function useChannels(agentId: string) {
  return useQuery({
    queryKey: channelsKey(agentId),
    queryFn: async () => {
      const page = await request({ schema: CHANNEL_LIST, path: on({ agentId, path: `/api/channels?${new URLSearchParams({ agentId })}` }) })
      return Promise.all(page.data.map((channel) => channel.status === 'linking' ? request({ schema: Channel, path: on({ agentId, path: channelPath(channel.id) }) }) : channel))
    },
    refetchInterval: (query) => query.state.data?.some((channel) => channel.status === 'linking') ? 3_000 : false,
  })
}

export function useCreateChannel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateChannel) => request({ schema: Channel, path: on({ agentId: body.agentId, path: '/api/channels' }), method: 'POST', body }),
    onSuccess: (channel) => writeChannel(client, channel),
  })
}

export function useUpdateChannel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ channel, change }: { channel: Channel; change: UpdateChannel }) => request({ schema: Channel, path: on({ agentId: channel.agentId, path: channelPath(channel.id) }), method: 'PATCH', body: change }),
    onSuccess: (channel) => {
      writeChannel(client, channel)
      void client.invalidateQueries({ queryKey: conversationsKey(channel.id) })
    },
  })
}

export function useConversations(channel: Channel) {
  return useQuery({
    queryKey: conversationsKey(channel.id),
    queryFn: () => request({ schema: CONVERSATION_LIST, path: on({ agentId: channel.agentId, path: `${channelPath(channel.id)}/conversations` }) }).then((page) => page.data),
    staleTime: 30_000,
  })
}

export function useDeleteChannel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (channel: Channel) => request({ schema: DELETED_CHANNEL, path: on({ agentId: channel.agentId, path: channelPath(channel.id) }), method: 'DELETE' }),
    onSuccess: (_, channel) => client.setQueryData<Channel[]>(channelsKey(channel.agentId), (channels) => channels?.filter((each) => each.id !== channel.id)),
  })
}

export function useSkills(agentId: string) {
  return useQuery({ queryKey: ['skills', agentId], queryFn: () => request({ schema: SKILL_LIST, path: on({ agentId, path: `/api/skills?${new URLSearchParams({ agentId })}` }) }).then((page) => page.data) })
}

export function useSkill({ skillId, agentId }: { skillId: string; agentId: string }) {
  return useQuery({ queryKey: ['skill', skillId], queryFn: () => request({ schema: Skill, path: on({ agentId, path: skillPath(skillId) }) }) })
}

export function useUpdateSkill({ skillId, agentId }: { skillId: string; agentId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => request({ schema: Skill, path: on({ agentId, path: skillPath(skillId) }), method: 'PATCH', body: { body } }),
    onSuccess: (skill) => {
      client.setQueryData(['skill', skill.id], skill)
      client.setQueryData<Skill[]>(['skills', skill.agentId], (skills) => skills?.map((each) => each.id === skill.id ? { ...skill, body: null } : each))
    },
  })
}

export function useDeleteSkill({ skillId, agentId }: { skillId: string; agentId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: DELETED_SKILL, path: on({ agentId, path: skillPath(skillId) }), method: 'DELETE' }),
    onSuccess: () => {
      client.removeQueries({ queryKey: ['skill', skillId] })
      client.setQueryData<Skill[]>(['skills', agentId], (skills) => skills?.filter((each) => each.id !== skillId))
    },
  })
}

export function useMemory(agentId: string) {
  return useQuery({ queryKey: ['memory', agentId], queryFn: () => request({ schema: Memory, path: memoryPath(agentId) }) })
}

export function useUpdateMemory(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateMemory) => request({ schema: Memory, path: memoryPath(agentId), method: 'PATCH', body: patch }),
    onSuccess: (memory) => client.setQueryData(['memory', agentId], memory),
  })
}

function memoryPath(agentId: string) {
  return on({ agentId, path: `/api/memories/${encodeURIComponent(agentId)}` })
}

function skillPath(skillId: string) {
  return `/api/skills/${encodeURIComponent(skillId)}`
}

function agentPath(agentId: string) {
  return on({ agentId, path: `/api/agents/${encodeURIComponent(agentId)}` })
}

function channelPath(channelId: string) {
  return `/api/channels/${encodeURIComponent(channelId)}`
}

function conversationsKey(channelId: string) {
  return ['conversations', channelId]
}

function channelsKey(agentId: string) {
  return ['channels', agentId]
}

function settling(agent: Agent | undefined) {
  return !!agent && ((agent.wanted === 'running') !== (agent.status === 'running') || agent.health === 'starting')
}

function writeGrant(client: QueryClient, grant: Grant, change: (grants: Grant[]) => Grant[]) {
  client.setQueryData<Grant[]>(grantsKey({ agentId: grant.agentId }), (grants) => grants && change(grants))
  client.setQueryData<Grant[]>(grantsKey({ connectionId: grant.connectionId }), (grants) => grants && change(grants))
  return client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
}

function writeChannel(client: QueryClient, channel: Channel) {
  client.setQueryData<Channel[]>(channelsKey(channel.agentId), (channels) => channels && [...channels.filter((each) => each.kind !== channel.kind), channel])
}

export function useMoveAgent() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; to: string }) => openhut.agents.move(input),
    onSuccess: ({ agent }) => {
      rememberHomes([agent])
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents?.map((each) => each.id === agent.id ? agent : each))
      void client.invalidateQueries({ queryKey: [...AGENTS_KEY, agent.id] })
      void client.resetQueries({ queryKey: ['threads', 'agent', agent.id] })
      for (const queryKey of [channelsKey(agent.id), ['skills', agent.id], ['memory', agent.id], ['conversations']]) void client.invalidateQueries({ queryKey })
      void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
      void client.invalidateQueries({ queryKey: GRANTS_KEY })
    },
  })
}
