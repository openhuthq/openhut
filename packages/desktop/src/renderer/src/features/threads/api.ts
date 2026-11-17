import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { Thread, ThreadWithMessages } from '@openhut/common/threads/thread.ts'
import { request } from '@/lib/api-client'
import { on, onComputer, openhut } from '@/lib/openhut'
import { THREADS_KEY } from '@/lib/query-keys'

const THREAD_LIST = List(Thread)

export function useThreads() {
  return useQuery({
    queryKey: THREADS_KEY,
    queryFn: async () => (await Promise.all((await openhut.computers.list()).filter((computer) => computer.online)
      .map((computer) => request({ schema: THREAD_LIST, path: onComputer({ computer: computer.id, path: '/api/threads' }) }).then((page) => page.data, () => [])))).flat(),
  })
}

export function useAgentThread(agentId: string) {
  return useQuery({
    queryKey: [...THREADS_KEY, 'agent', agentId],
    queryFn: async () => {
      const thread = await request({ schema: Thread, path: on({ agentId, path: '/api/threads' }), method: 'POST', body: { agentId } })
      return request({ schema: ThreadWithMessages, path: on({ agentId, path: threadPath(thread.id) }) })
    },
    staleTime: Infinity,
  })
}

export function useTouchThread() {
  const client = useQueryClient()
  return (thread: Thread) => client.setQueryData<Thread[]>(THREADS_KEY, (threads) => threads && [{ ...thread, updatedAt: new Date().toISOString() }, ...threads.filter((each) => each.id !== thread.id)])
}

export function useClearChat(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (threadId: string) => request({ schema: Deleted('thread'), path: on({ agentId, path: threadPath(threadId) }), method: 'DELETE' }),
    onSuccess: () => client.resetQueries({ queryKey: [...THREADS_KEY, 'agent', agentId] }),
  })
}

export function threadPath(threadId: string) {
  return `/api/threads/${encodeURIComponent(threadId)}`
}
