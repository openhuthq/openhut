import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Admin, Update } from '@openhut/common/admin/admin.ts'
import { ComputerJoin, RemovedComputer } from '@openhut/common/computers/computer.ts'
import { request } from '@/lib/api-client'
import { HERE, openhut, type Computer, type Features } from '@/lib/openhut'
import { computerAdminsKey, COMPUTERS_KEY } from '@/lib/query-keys'

type ComputerAdmin = { computer: Computer; admin: Admin | undefined }

export function useComputers({ watching = false }: { watching?: boolean } = {}) {
  return useQuery({ queryKey: COMPUTERS_KEY, queryFn: () => openhut.computers.list(), refetchInterval: watching ? 2000 : undefined })
}

export function useFeatures(computer = HERE): Features {
  return useComputers().data?.find((each) => each.id === computer)?.features ?? { whatsapp: false, browser: false }
}

export function nameOf({ computers, id }: { computers: Computer[] | undefined; id: string }): string {
  return computers?.find((computer) => computer.id === id)?.name ?? 'another computer'
}

export function useComputerAdmins() {
  const here = useComputers().data?.find((computer) => computer.here)
  return useQuery({
    queryKey: computerAdminsKey(here?.id),
    queryFn: async (): Promise<ComputerAdmin[]> => here ? [{ computer: here, admin: await adminOf() }] : [],
    enabled: !!here,
  })
}

export function useJoinComputer() {
  return useMutation({ mutationFn: () => request({ schema: ComputerJoin, path: '/api/computers', method: 'POST' }) })
}

export function useRemoveComputer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) => request({ schema: RemovedComputer, path: `/api/computers/${encodeURIComponent(id)}`, method: 'DELETE' }),
    onSuccess: ({ id }) => client.setQueryData<Computer[]>(COMPUTERS_KEY, (computers) => computers?.filter((computer) => computer.id !== id)),
  })
}

export function startUpdate(): Promise<Update> {
  return request({ schema: Update, path: '/api/updates', method: 'POST' })
}

export function adminOf() {
  return request({ schema: Admin, path: '/api/admin' }).catch(() => undefined)
}
