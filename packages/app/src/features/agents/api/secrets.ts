import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { AgentSecret } from '@openhut/common/agents/secret.ts'
import { request } from '@/lib/api-client'
import { agentSecretsKey } from '@/lib/query-keys'

const SECRET_LIST = List(AgentSecret)
const DELETED_SECRET = Deleted('agent_secret')

export function useSecrets(agentId: string) {
  return useQuery({ queryKey: agentSecretsKey(agentId), queryFn: () => request({ schema: SECRET_LIST, of: agentId, path: `/api/agent-secrets?${new URLSearchParams({ agentId })}` }).then((page) => page.data) })
}

export function useReplaceSecret(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => request({ schema: AgentSecret, of: agentId, path: `/api/agent-secrets/${encodeURIComponent(id)}`, method: 'POST', body: { value } }),
    onSuccess: (saved) => client.setQueryData<AgentSecret[]>(agentSecretsKey(agentId), (all) => all?.map((each) => each.id === saved.id ? saved : each)),
  })
}

export function useDeleteSecret(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request({ schema: DELETED_SECRET, of: agentId, path: `/api/agent-secrets/${encodeURIComponent(id)}`, method: 'DELETE' }),
    onSuccess: ({ id }) => client.setQueryData<AgentSecret[]>(agentSecretsKey(agentId), (all) => all?.filter((each) => each.id !== id)),
  })
}
