import { useQuery } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import { Routine } from '@openhut/common/routines/routine.ts'
import { request } from '@/lib/api-client'
import { routinesKey } from '@/lib/query-keys'

const ROUTINE_LIST = List(Routine)

export function useRoutines(agentId: string) {
  return useQuery({
    queryKey: routinesKey(agentId),
    queryFn: () => request({ schema: ROUTINE_LIST, of: agentId, path: `/api/routines?${new URLSearchParams({ agentId })}` }).then((page) => page.data),
  })
}
