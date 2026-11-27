import { useEffect, useState } from 'react'
import { queryOptions, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import { Deleted } from '@openhut/common/api.ts'
import { Agent, type CreateAgent } from '@openhut/common/agents/agent.ts'
import { AgentFace } from '@openhut/common/agents/face.ts'
import type { OpenHutAgent } from '@/lib/openhut'
import { request } from '@/lib/api-client'
import { agentFaceKey, AGENTS_KEY, agentKey, CONNECTIONS_KEY, GRANTS_KEY } from '@/lib/query-keys'
import { navigate } from '@/lib/router'

const DELETED_AGENT = Deleted('agent')

export function useCreateAgent() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateAgent) => {
      const agent = await request({ schema: Agent, path: '/api/agents', method: 'POST', body })
      return request({ schema: Agent, path: agentPath(agent.id), method: 'PATCH', body: { wanted: 'running' } })
    },
    onSuccess: (agent) => {
      client.setQueryData(agentKey(agent.id), agent)
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents && [...agents, { ...agent, computer: agent.runsOn ?? 'here', online: true }])
      navigate(`/agents/${encodeURIComponent(agent.id)}`)
    },
  })
}

const RESTARTS = ['instructions', 'model', 'codeExecution', 'browser'] as const
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

export function useDeleteAgent(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: DELETED_AGENT, of: agentId, path: agentPath(agentId), method: 'DELETE' }),
    onSuccess: () => {
      navigate('/')
      client.removeQueries({ queryKey: agentKey(agentId) })
      client.setQueryData<OpenHutAgent[]>(AGENTS_KEY, (agents) => agents?.filter((agent) => agent.id !== agentId))
      void client.invalidateQueries({ queryKey: GRANTS_KEY })
      void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
    },
  })
}

function agentPath(agentId: string) {
  return `/api/agents/${encodeURIComponent(agentId)}`
}

export const agentFaceQuery = (agentId: string) => queryOptions({ queryKey: agentFaceKey(agentId), queryFn: () => request({ schema: AgentFace, path: `/api/agent-faces/${agentId}` }), staleTime: Infinity })

export function saveAgentFace({ agentId, png }: { agentId: string; png: string }) {
  return request({ schema: AgentFace, path: `/api/agent-faces/${agentId}`, method: 'PUT', body: { png } })
}
