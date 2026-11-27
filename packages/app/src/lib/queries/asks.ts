import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import { Ask } from '@openhut/common/asks/ask.ts'
import { request } from '@/lib/api-client'
import { agentSecretsKey, agentToolsKey, asksKey, CONNECTIONS_KEY, GRANTS_KEY } from '@/lib/query-keys'

const ASK_LIST = List(Ask)

export function useAsks(agentId: string) {
  return useQuery({ queryKey: asksKey(agentId), queryFn: () => request({ schema: ASK_LIST, of: agentId, path: `/api/asks?${new URLSearchParams({ agentId })}` }).then((page) => page.data) })
}

export function useAnswer(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, verb, body }: { id: string; verb: 'approvals' | 'declines' | 'undos'; body: object }) => request({ schema: Ask, of: agentId, path: `/api/asks/${encodeURIComponent(id)}/${verb}`, method: 'POST', body }),
    onSuccess: (answered) => {
      client.setQueryData<Ask[]>(asksKey(agentId), (all) => all?.map((each) => each.id === answered.id ? answered : each))
      void Promise.all([CONNECTIONS_KEY, GRANTS_KEY, agentToolsKey(agentId), agentSecretsKey(agentId)].map((queryKey) => client.invalidateQueries({ queryKey })))
    },
  })
}

