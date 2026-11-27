import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import { Place } from '@openhut/common/channels/channel.ts'
import { NotifySettings } from '@/lib/places'
import { request } from '@/lib/api-client'
import { notifyKey, placesKey } from '@/lib/query-keys'

const PLACE_LIST = List(Place)

export function usePlaces(agentId: string) {
  return useQuery({
    queryKey: placesKey(agentId),
    queryFn: () => request({ schema: PLACE_LIST, of: agentId, path: `/api/agents/${encodeURIComponent(agentId)}/places` }).then((page) => page.data),
  })
}

export function useNotify(agentId: string, enabled = true) {
  return useQuery({
    queryKey: notifyKey(agentId),
    enabled,
    retry: false,
    queryFn: () => request({ schema: NotifySettings, of: agentId, path: `/api/agents/${encodeURIComponent(agentId)}/notify` }),
  })
}

export function useSaveNotify(agentId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: NotifySettings) => request({ schema: NotifySettings, of: agentId, path: `/api/agents/${encodeURIComponent(agentId)}/notify`, method: 'PUT', body }),
    onSuccess: (settings) => client.setQueryData(notifyKey(agentId), settings),
  })
}
