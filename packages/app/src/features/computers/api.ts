import { useQuery } from '@tanstack/react-query'
import { Admin, Update } from '@openhut/common/admin/admin.ts'
import { request } from '@/lib/api-client'
import { openhut, type Computer, type Features } from '@/lib/openhut'
import { COMPUTERS_KEY } from '@/lib/query-keys'

type ComputerAdmin = { computer: Computer; admin: Admin | undefined }

const ADMINS_KEY = [...COMPUTERS_KEY, 'admins']

export function useComputers() {
  return useQuery({ queryKey: COMPUTERS_KEY, queryFn: () => openhut.computers.list() })
}

export function useFeatures(): Features {
  return useComputers().data?.[0]?.features ?? { whatsapp: false, browser: false }
}

export function useComputerAdmins() {
  const computers = useComputers().data
  return useQuery({
    queryKey: [...ADMINS_KEY, computers?.map((computer) => `${computer.id}:${computer.online}`)],
    queryFn: (): Promise<ComputerAdmin[]> => Promise.all((computers ?? []).map(async (computer) => ({ computer, admin: computer.online ? await adminOf() : undefined }))),
    enabled: !!computers,
  })
}

export function startUpdate(): Promise<Update> {
  return request({ schema: Update, path: '/api/updates', method: 'POST' })
}

export function adminOf() {
  return request({ schema: Admin, path: '/api/admin' }).catch(() => undefined)
}
