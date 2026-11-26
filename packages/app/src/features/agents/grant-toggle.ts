import type { MutationOptions, QueryClient } from '@tanstack/react-query'
import type { Grant } from '@openhut/common/agents/agent.ts'
import { CONNECTIONS_KEY, grantsKey } from '../../lib/query-keys.ts'

type Pair = { agentId: string; connectionId: string }
type Snapshot = { keys: ReturnType<typeof grantsKey>[]; before: (Grant[] | undefined)[] }

export const grantId = ({ agentId, connectionId }: Pair): string => `${agentId}~${connectionId}`

export function grantToggle<R, V extends Pair>({ client, on, mutationFn }: { client: QueryClient; on: boolean; mutationFn: (variables: V) => Promise<R> }): MutationOptions<R, Error, V, Snapshot> {
  return {
    mutationFn,
    scope: { id: 'grants' },
    onMutate: async (pair) => {
      const keys = [grantsKey({ agentId: pair.agentId }), grantsKey({ connectionId: pair.connectionId })]
      await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })))
      const before = keys.map((queryKey) => client.getQueryData<Grant[]>(queryKey))
      const grant: Grant = { id: grantId(pair), object: 'grant', agentId: pair.agentId, connectionId: pair.connectionId, createdAt: new Date().toISOString() }
      for (const queryKey of keys) client.setQueryData<Grant[]>(queryKey, (grants) => grants && [...grants.filter((each) => each.id !== grant.id), ...on ? [grant] : []])
      return { keys, before }
    },
    onError: (_error, _pair, snapshot) => snapshot?.keys.forEach((queryKey, index) => client.setQueryData(queryKey, snapshot.before[index])),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
    },
  }
}
