import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Admin, SeatSignIn, SeatUsage } from '@openhut/common/admin/admin.ts'
import { request } from '@/lib/api-client'
import { Invitation } from '@/features/settings/invitation'
import { devices } from '@/lib/openhut'
import { AGENTS_KEY, COMPUTERS_KEY } from '@/lib/query-keys'

const ADMIN_KEY = ['admin']
const DEVICES_KEY = ['devices']
const INVITATION_POLL_MS = 1000

export function useDevices() {
  return useQuery({ queryKey: DEVICES_KEY, queryFn: () => devices.list() })
}

export function useRemoveDevice() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => devices.remove(key),
    onSuccess: (list) => client.setQueryData(DEVICES_KEY, list),
  })
}

export function useNewInvitation() {
  return useMutation({ mutationFn: () => request({ schema: Invitation, computer: 'local', path: '/api/invitations', method: 'POST' }) })
}

export function useInvitation(id: string | undefined) {
  return useQuery({
    queryKey: ['invitation', id],
    queryFn: () => request({ schema: Invitation, computer: 'local', path: `/api/invitations/${encodeURIComponent(id ?? '')}` }),
    enabled: !!id,
    refetchInterval: (query) => ['waiting', 'joined', undefined].includes(query.state.data?.status) ? INVITATION_POLL_MS : false,
  })
}

export function useDecline() {
  return useMutation({ mutationFn: (id: string) => request({ schema: Invitation, computer: 'local', path: `/api/invitations/${encodeURIComponent(id)}`, method: 'DELETE' }) })
}

export function useAllow() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => devices.allow(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: DEVICES_KEY })
      void client.invalidateQueries({ queryKey: COMPUTERS_KEY })
    },
  })
}

export function useAdmin() {
  return useQuery({ queryKey: ADMIN_KEY, queryFn: () => request({ schema: Admin, computer: 'local', path: '/api/admin' }) })
}

export function useSeatUsage(enabled: boolean) {
  return useQuery({ queryKey: ['seat-usage'], queryFn: () => request({ schema: SeatUsage, computer: 'local', path: '/api/admin/seat-usage' }), retry: false, enabled })
}

export function useStartSeatSignIn() {
  return useMutation({ mutationFn: () => request({ schema: SeatSignIn, computer: 'local', path: '/api/admin/seat-sign-ins', method: 'POST' }) })
}

export function useCompleteSeatSignIn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, code }: { id: string; code: string }) => request({ schema: SeatSignIn, computer: 'local', path: `/api/admin/seat-sign-ins/${encodeURIComponent(id)}`, method: 'PATCH', body: { code } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ADMIN_KEY })
      void client.invalidateQueries({ queryKey: AGENTS_KEY })
    },
  })
}

