import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { Grant } from '@openhut/common/agents/agent.ts'
import { openhut } from '@/lib/openhut'
import { request } from '@/lib/api-client'
import { CONNECTIONS_KEY, grantsKey } from '@/lib/query-keys'

const GRANT_LIST = List(Grant)
const DELETED_GRANT = Deleted('grant')

export function useGrants(filter: { agentId: string } | { connectionId: string }) {
  return useQuery({ queryKey: grantsKey(filter), queryFn: () => request({ schema: GRANT_LIST, of: 'agentId' in filter ? filter.agentId : filter.connectionId, path: `/api/grants?${new URLSearchParams(filter)}` }).then((page) => page.data) })
}

export function useConnectionGrants(connection: { computers: { id: string }[] }) {
  return useQueries({
    queries: connection.computers.map(({ id }) => ({ queryKey: grantsKey({ connectionId: id }), queryFn: () => request({ schema: GRANT_LIST, of: id, path: `/api/grants?${new URLSearchParams({ connectionId: id })}` }).then((page) => page.data) })),
    combine: (results) => ({ data: results.every((result) => result.data) ? results.flatMap((result) => result.data ?? []) : undefined }),
  })
}

export function useCreateGrant() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { agentId: string; connectionId: string }) => openhut.connections.grant({ agent: body.agentId, connection: body.connectionId }),
    onSuccess: (grant) => writeGrant(client, grant, (grants) => [...grants.filter((each) => each.id !== grant.id), grant]),
  })
}

export function useDeleteGrant() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (grant: Grant) => request({ schema: DELETED_GRANT, of: grant.agentId, path: `/api/grants/${encodeURIComponent(grant.id)}`, method: 'DELETE' }),
    onSuccess: (_, grant) => writeGrant(client, grant, (grants) => grants.filter((each) => each.id !== grant.id)),
  })
}

function writeGrant(client: QueryClient, grant: Grant, change: (grants: Grant[]) => Grant[]) {
  client.setQueryData<Grant[]>(grantsKey({ agentId: grant.agentId }), (grants) => grants && change(grants))
  client.setQueryData<Grant[]>(grantsKey({ connectionId: grant.connectionId }), (grants) => grants && change(grants))
  void client.invalidateQueries({ queryKey: CONNECTIONS_KEY })
}
