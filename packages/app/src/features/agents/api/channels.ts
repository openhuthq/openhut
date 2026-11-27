import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Deleted, List } from '@openhut/common/api.ts'
import { Channel, Conversation, TelegramInvite, type CreateChannel, type UpdateChannel } from '@openhut/common/channels/channel.ts'
import { request } from '@/lib/api-client'
import { channelsKey, conversationsKey } from '@/lib/query-keys'

const CHANNEL_LIST = List(Channel)
const CONVERSATION_LIST = List(Conversation)
const DELETED_CHANNEL = Deleted('channel')

export function useChannels(agentId: string) {
  return useQuery({
    queryKey: channelsKey(agentId),
    queryFn: async () => {
      const page = await request({ schema: CHANNEL_LIST, of: agentId, path: `/api/channels?${new URLSearchParams({ agentId })}` })
      return Promise.all(page.data.map((channel) => channel.status === 'linking' ? request({ schema: Channel, of: agentId, path: channelPath(channel.id) }) : channel))
    },
    refetchInterval: (query) => query.state.data?.some((channel) => channel.status === 'linking') ? 3_000 : false,
  })
}

export function useCreateChannel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateChannel) => request({ schema: Channel, of: body.agentId, path: '/api/channels', method: 'POST', body }),
    onSuccess: (channel) => writeChannel(client, channel),
  })
}

export function useUpdateChannel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ channel, change }: { channel: Channel; change: UpdateChannel }) => request({ schema: Channel, of: channel.agentId, path: channelPath(channel.id), method: 'PATCH', body: change }),
    onSuccess: (channel) => {
      writeChannel(client, channel)
      void client.invalidateQueries({ queryKey: conversationsKey(channel.id) })
    },
  })
}

export function useTelegramInvite() {
  return useMutation({
    mutationFn: (channel: Channel) => request({ schema: TelegramInvite, of: channel.agentId, path: `${channelPath(channel.id)}/telegram-invites`, method: 'POST' }),
  })
}

export function useConversations(channel: Channel | undefined, { waiting = false }: { waiting?: boolean } = {}) {
  return useQuery({
    queryKey: conversationsKey(channel?.id ?? ''),
    queryFn: () => request({ schema: CONVERSATION_LIST, of: channel?.agentId ?? '', path: `${channelPath(channel?.id ?? '')}/conversations` }).then((page) => page.data),
    enabled: !!channel,
    staleTime: waiting ? 0 : 30_000,
    refetchInterval: (query) => waiting && !query.state.data?.length ? 3_000 : false,
  })
}

export function useDeleteChannel() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (channel: Channel) => request({ schema: DELETED_CHANNEL, of: channel.agentId, path: channelPath(channel.id), method: 'DELETE' }),
    onSuccess: (_, channel) => client.setQueryData<Channel[]>(channelsKey(channel.agentId), (channels) => channels?.filter((each) => each.id !== channel.id)),
  })
}

function channelPath(channelId: string) {
  return `/api/channels/${encodeURIComponent(channelId)}`
}

function writeChannel(client: QueryClient, channel: Channel) {
  client.setQueryData<Channel[]>(channelsKey(channel.agentId), (channels) => channels && [...channels.filter((each) => each.kind !== channel.kind), channel])
}
