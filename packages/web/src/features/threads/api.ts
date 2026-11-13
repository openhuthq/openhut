import { useQuery } from '@tanstack/react-query'
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

export function threadPath(threadId: string) {
  return `/api/threads/${encodeURIComponent(threadId)}`
}
