import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Admin, SeatSignIn, SeatUsage, type UpdateAdmin } from '@openhut/common/admin/admin.ts'
import { request } from '@/lib/api-client'
import { devices } from '@/lib/openhut'
import { AGENTS_KEY } from '@/lib/query-keys'

const ADMIN_KEY = ['admin']
const DEVICES_KEY = ['devices']

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

export function useAdmin() {
  return useQuery({ queryKey: ADMIN_KEY, queryFn: () => request({ schema: Admin, computer: 'local', path: '/api/admin' }) })
}

export function useSeatUsage(enabled: boolean) {
  return useQuery({ queryKey: ['seat-usage'], queryFn: () => request({ schema: SeatUsage, computer: 'local', path: '/api/admin/seat-usage' }), retry: false, enabled })
}

export function useUpdateAdmin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAdmin) => request({ schema: Admin, computer: 'local', path: '/api/admin', method: 'PATCH', body }),
    onSuccess: (admin) => client.setQueryData(ADMIN_KEY, admin),
  })
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

