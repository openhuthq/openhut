import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { Routine, type UpdateRoutine } from '@openhut/common/routines/routine.ts'
import { DeliveryTarget } from '@openhut/common/webhooks/webhook.ts'
import { request } from '@/lib/api-client'

const ROUTINE_LIST = List(Routine)
const DELETED_ROUTINE = Deleted('routine')

export const routinesKey = (agentId: string) => ['routines', agentId]

export function useRoutines(agentId: string) {
  return useQuery({
    queryKey: routinesKey(agentId),
    queryFn: () => request({ schema: ROUTINE_LIST, of: agentId, path: `/api/routines?${new URLSearchParams({ agentId })}` }).then((page) => page.data),
  })
}

export function useStopRoutine(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request({ schema: DELETED_ROUTINE, of: agentId, path: `/api/routines/${encodeURIComponent(id)}`, method: 'DELETE' }),
    onSuccess: (gone) => client.setQueryData<Routine[]>(routinesKey(agentId), (routines) => routines?.filter((each) => each.id !== gone.id)),
  })
}

export function useUpdateRoutine(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateRoutine) => request({ schema: Routine, of: agentId, path: `/api/routines/${encodeURIComponent(id)}`, method: 'PATCH', body }),
    onSuccess: (routine) => client.setQueryData<Routine[]>(routinesKey(agentId), (routines) => routines?.map((each) => each.id === routine.id ? routine : each)),
  })
}

const TARGET_LIST = List(DeliveryTarget)

export function useDeliveryTargets(agentId: string) {
  return useQuery({
    queryKey: ['delivery-targets', agentId],
    queryFn: () => request({ schema: TARGET_LIST, of: agentId, path: `/api/delivery-targets?${new URLSearchParams({ agentId })}` }).then((page) => page.data),
  })
}
