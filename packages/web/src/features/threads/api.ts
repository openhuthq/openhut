import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { List } from '@fastmonkey/common/api.ts'
import { Thread, ThreadWithMessages, type CreateThread } from '@fastmonkey/common/threads/thread.ts'
import { request } from '@/lib/api-client'
import { THREADS_KEY } from '@/lib/query-keys'

const THREAD_LIST = List(Thread)

export function useThreads() {
  return useQuery({ queryKey: THREADS_KEY, queryFn: () => request({ schema: THREAD_LIST, path: '/api/threads' }).then((page) => page.data) })
}

export function useThread(threadId: string) {
  return useQuery({ queryKey: [...THREADS_KEY, threadId], queryFn: () => request({ schema: ThreadWithMessages, path: threadPath(threadId) }), staleTime: Infinity })
}

export function useCreateThread() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateThread) => request({ schema: Thread, path: '/api/threads', method: 'POST', body }),
    onSuccess: (thread) => {
      client.setQueryData([...THREADS_KEY, thread.id], { ...thread, messages: [] })
      client.setQueryData<Thread[]>(THREADS_KEY, (threads) => threads && [thread, ...threads])
    },
  })
}

export function useTouchThread() {
  const client = useQueryClient()
  return (threadId: string) => client.setQueryData<Thread[]>(THREADS_KEY, (threads) => {
    const thread = threads?.find((each) => each.id === threadId)
    return thread && threads ? [{ ...thread, updatedAt: new Date().toISOString() }, ...threads.filter((each) => each !== thread)] : threads
  })
}

export function threadPath(threadId: string) {
  return `/api/threads/${encodeURIComponent(threadId)}`
}
