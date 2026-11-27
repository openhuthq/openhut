import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Agent, type UpdateAgent } from '@openhut/common/agents/agent.ts'
import { openhut, type OpenHutAgent } from '@/lib/openhut'
import { request } from '@/lib/api-client'
import { AGENTS_KEY, agentKey } from '@/lib/query-keys'
import { localFace } from '@/components/agent-face'

export function useAgents() {
  return useQuery({ queryKey: AGENTS_KEY, queryFn: () => openhut.agents.list() })
}

const sharedFaces = new Set<string>()

export function useShareLocalFaces(agents: OpenHutAgent[] | undefined) {
  const client = useQueryClient()
  useEffect(() => {
    for (const agent of agents ?? []) {
      const face = !agent.face && agent.canEdit && agent.online && !sharedFaces.has(agent.id) ? localFace(agent.id) : null
      if (face) sharedFaces.add(agent.id)
      if (face) void request({ schema: Agent, of: agent.id, path: agentPath(agent.id), method: 'PATCH', body: { face } })
        .then((saved) => client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (list) => list?.map((each) => each.id === saved.id ? { ...each, face: saved.face } : each)), () => undefined)
    }
  }, [agents, client])
}

export function useAgent(agentId: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: agentKey(agentId),
    queryFn: async () => {
      const agent = await request({ schema: Agent, of: agentId, path: agentPath(agentId) })
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (list) => list?.map((each) => each.id === agent.id ? { ...each, status: agent.status, health: agent.health, healthDetail: agent.healthDetail, wanted: agent.wanted } : each))
      return agent
    },
    placeholderData: () => client.getQueryData<OpenHutAgent[]>(AGENTS_KEY)?.find((each) => each.id === agentId),
  })
}

export function useUpdateAgent(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['agent-update', agentId],
    mutationFn: (body: UpdateAgent) => request({ schema: Agent, of: agentId, path: agentPath(agentId), method: 'PATCH', body }),
    onMutate: (body) => {
      client.setQueryData<Agent>(agentKey(agentId), (agent) => agent && { ...agent, ...body })
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents?.map((each) => each.id === agentId ? { ...each, ...body } : each))
    },
    onError: () => client.invalidateQueries({ queryKey: AGENTS_KEY }),
    onSuccess: (agent) => {
      client.setQueryData(agentKey(agent.id), agent)
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents?.map((each) => each.id === agent.id ? { ...each, ...agent } : each))
    },
  })
}

export function useRetryApply(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: Agent, of: agentId, path: `${agentPath(agentId)}/apply`, method: 'POST' }),
    onSuccess: (agent) => {
      client.setQueryData(agentKey(agent.id), agent)
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents?.map((each) => each.id === agent.id ? { ...each, ...agent } : each))
    },
  })
}

function agentPath(agentId: string) {
  return `/api/agents/${encodeURIComponent(agentId)}`
}
