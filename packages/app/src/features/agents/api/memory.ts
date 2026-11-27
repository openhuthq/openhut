import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Memory, type UpdateMemory } from '@openhut/common/agents/memory.ts'
import { request } from '@/lib/api-client'
import { memoryKey } from '@/lib/query-keys'

export function useMemory(agentId: string) {
  return useQuery({ queryKey: memoryKey(agentId), queryFn: () => request({ schema: Memory, of: agentId, path: memoryPath(agentId) }) })
}

export function useUpdateMemory(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateMemory) => request({ schema: Memory, of: agentId, path: memoryPath(agentId), method: 'PATCH', body: patch }),
    onSuccess: (memory) => client.setQueryData(memoryKey(agentId), memory),
  })
}

function memoryPath(agentId: string) {
  return `/api/memories/${encodeURIComponent(agentId)}`
}
