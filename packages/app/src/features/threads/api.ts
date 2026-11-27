import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import * as z from 'zod/mini'
import { ChatFile, ChatMessage, HomeFile } from '@openhut/common/threads/thread.ts'
import { request, requestBlob } from '@/lib/api-client'
import { THREADS_KEY } from '@/lib/query-keys'
import { RASTER } from '@/features/threads/files'
import { SourcedThread } from '@/features/threads/places'

const THREAD_LIST = List(SourcedThread)
const THREAD_WITH_MESSAGES = z.extend(SourcedThread, { messages: z.array(ChatMessage) })
export type ThreadWithMessages = z.infer<typeof THREAD_WITH_MESSAGES>
const HOME_FILES = List(HomeFile)

export function useThreads() {
  return useQuery({
    queryKey: THREADS_KEY,
    queryFn: async () => (await request({ schema: THREAD_LIST, path: '/api/threads' })).data,
  })
}

export function useThread({ agentId, threadId }: { agentId: string; threadId: string }) {
  return useQuery({
    queryKey: [...THREADS_KEY, 'thread', threadId],
    queryFn: () => request({ schema: THREAD_WITH_MESSAGES, of: agentId, path: threadPath(threadId) }),
    staleTime: Infinity,
  })
}

export function useTouchThread() {
  const client = useQueryClient()
  return (thread: SourcedThread) => {
    client.setQueryData<SourcedThread[]>(THREADS_KEY, (threads) => threads && [{ ...thread, updatedAt: new Date().toISOString() }, ...threads.filter((each) => each.id !== thread.id)])
    void client.invalidateQueries({ queryKey: [...THREADS_KEY, 'thread', thread.id], refetchType: 'all' })
  }
}

export function useClearChat({ agentId, threadId }: { agentId: string; threadId: string }) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ uploads }: { uploads: string[] }) => request({ schema: Deleted('thread'), of: agentId, path: threadPath(threadId), method: 'DELETE', body: { uploads } }),
    onSuccess: () => client.setQueryData<ThreadWithMessages>([...THREADS_KEY, 'thread', threadId], (thread) => thread && { ...thread, messages: [] }),
  })
}

export function useArchiveThread(thread: SourcedThread) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: SourcedThread, of: thread.agentId, path: `${threadPath(thread.id)}/archive`, method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: THREADS_KEY }),
  })
}

export function threadPath(threadId: string) {
  return `/api/threads/${encodeURIComponent(threadId)}`
}

export function uploadFile({ agentId, threadId, file }: { agentId: string; threadId: string; file: File }) {
  const query = new URLSearchParams({ name: file.name, type: file.type })
  return request({ schema: ChatFile, of: agentId, path: `${threadPath(threadId)}/files?${query}`, method: 'POST', body: file })
}

export async function saveFile({ agentId, threadId, path }: { agentId: string; threadId: string; path: string }) {
  const blob = await requestBlob({ of: agentId, path: `${threadPath(threadId)}/files?${new URLSearchParams({ path })}` })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = path.slice(path.lastIndexOf('/') + 1)
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}

export function deleteUpload({ agentId, threadId, path }: { agentId: string; threadId: string; path: string }) {
  return request({ schema: Deleted('file'), of: agentId, path: `${threadPath(threadId)}/files?${new URLSearchParams({ path })}`, method: 'DELETE' })
}

export function useHomeFiles({ agentId, threadId, paths }: { agentId: string; threadId: string; paths: string[] }) {
  return useQuery({
    queryKey: [...THREADS_KEY, 'files', threadId, paths],
    queryFn: async () => new Set((await request({ schema: HOME_FILES, of: agentId, path: `${threadPath(threadId)}/files/lookups`, method: 'POST', body: { paths } })).data.map((file) => file.path)),
    enabled: paths.length > 0,
    staleTime: 60_000,
  }).data
}

export function useThumb({ agentId, threadId, path, mediaType }: { agentId: string; threadId: string; path: string; mediaType: string }) {
  return useQuery({
    queryKey: [...THREADS_KEY, 'thumb', agentId, path],
    queryFn: async () => URL.createObjectURL(new Blob([await requestBlob({ of: agentId, path: `${threadPath(threadId)}/files?${new URLSearchParams({ path })}` })], { type: mediaType })),
    enabled: RASTER.includes(mediaType),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  }).data
}
