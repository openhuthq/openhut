import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Skill } from '@openhut/common/agents/skill.ts'
import { request } from '@/lib/api-client'
import { agentKey, skillKey, skillsKey } from '@/lib/query-keys'

const SKILL_LIST = List(Skill)
const DELETED_SKILL = Deleted('skill')

export function useSkills(agentId: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: skillsKey(agentId),
    queryFn: () => request({ schema: SKILL_LIST, of: agentId, path: `/api/skills?${new URLSearchParams({ agentId })}` }).then((page) => page.data),
    refetchInterval: (query) => !query.state.data?.length && client.getQueryData<Agent>(agentKey(agentId))?.status === 'running' ? 3_000 : false,
  })
}

export function useSkill({ skillId, agentId }: { skillId: string; agentId: string }) {
  return useQuery({ queryKey: skillKey(skillId), queryFn: () => request({ schema: Skill, of: agentId, path: skillPath(skillId) }) })
}

export function useUpdateSkill({ skillId, agentId }: { skillId: string; agentId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => request({ schema: Skill, of: agentId, path: skillPath(skillId), method: 'PATCH', body: { body } }),
    onSuccess: (skill) => {
      client.setQueryData(skillKey(skill.id), skill)
      client.setQueryData<Skill[]>(skillsKey(skill.agentId), (skills) => skills?.map((each) => each.id === skill.id ? { ...skill, body: null } : each))
    },
  })
}

export function useDeleteSkill({ skillId, agentId }: { skillId: string; agentId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: DELETED_SKILL, of: agentId, path: skillPath(skillId), method: 'DELETE' }),
    onSuccess: () => {
      client.removeQueries({ queryKey: skillKey(skillId) })
      client.setQueryData<Skill[]>(skillsKey(agentId), (skills) => skills?.filter((each) => each.id !== skillId))
    },
  })
}

function skillPath(skillId: string) {
  return `/api/skills/${encodeURIComponent(skillId)}`
}
