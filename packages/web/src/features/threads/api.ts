import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted } from '@fastmonkey/common/api.ts'
import { Thread, ThreadWithMessages } from '@fastmonkey/common/threads/thread.ts'
import { request } from '@/lib/api-client'
import { THREADS_KEY } from '@/lib/query-keys'

export function useAgentThread(agentId: string) {
  return useQuery({
    queryKey: [...THREADS_KEY, 'agent', agentId],
    queryFn: async () => {
      const thread = await request({ schema: Thread, path: '/api/threads', method: 'POST', body: { agentId } })
      return request({ schema: ThreadWithMessages, path: threadPath(thread.id) })
    },
    staleTime: Infinity,
  })
}

export function useClearChat(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (threadId: string) => request({ schema: Deleted('thread'), path: threadPath(threadId), method: 'DELETE' }),
    onSuccess: () => client.resetQueries({ queryKey: [...THREADS_KEY, 'agent', agentId] }),
  })
}

export function threadPath(threadId: string) {
  return `/api/threads/${encodeURIComponent(threadId)}`
}
