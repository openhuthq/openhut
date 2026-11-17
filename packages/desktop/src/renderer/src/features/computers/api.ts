import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Computer } from '@openhut/client'
import { Admin } from '@openhut/common/admin/admin.ts'
import { ApiError } from '@openhut/common/api.ts'
import { openhut } from '@/lib/openhut'
import { AGENTS_KEY, COMPUTERS_KEY, CONNECTIONS_KEY } from '@/lib/query-keys'

export type ComputerAdmin = { computer: Computer; admin: Admin | undefined }

const ADMINS_KEY = [...COMPUTERS_KEY, 'admins']

export function useComputers() {
  return useQuery({ queryKey: COMPUTERS_KEY, queryFn: () => openhut.computers.list() })
}

export function useComputerAdmins() {
  return useQuery({
    queryKey: ADMINS_KEY,
    queryFn: async (): Promise<ComputerAdmin[]> => Promise.all((await openhut.computers.list()).map(async (computer) => ({ computer, admin: computer.online ? await adminOf(computer.id) : undefined }))),
  })
}

export function useRemoveComputer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, agents }: { id: string; agents: string[] }) => {
      await Promise.all(agents.map((agent) => openhut.agents.update({ id: agent, change: { wanted: 'stopped' } })))
      await openhut.computers.remove(id)
    },
    onSuccess: () => {
      for (const queryKey of [COMPUTERS_KEY, AGENTS_KEY, CONNECTIONS_KEY]) void client.invalidateQueries({ queryKey })
    },
  })
}

export function nameOf({ computers, id }: { computers: Computer[] | undefined; id: string }) {
  return computers?.find((each) => each.id === id)?.name ?? id
}

async function adminOf(computer: string) {
  const response = await openhut.fetch({ computer, path: '/api/admin' }).catch(() => undefined)
  return Admin.safeParse(await response?.json().catch(() => null)).data
}

export function useUpdateComputer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (computer: Computer) => {
      const response = await openhut.fetch({ computer: computer.id, path: '/api/updates', init: { method: 'POST' } })
      if (!response.ok) throw new Error(ApiError.safeParse(await response.json().catch(() => null)).data?.error.message ?? `${computer.name} answered ${response.status}.`)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: COMPUTERS_KEY }),
  })
}

export function useAdoptComputer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; url: string; key: string }) => openhut.computers.adopt(input),
    onSuccess: () => client.invalidateQueries({ queryKey: COMPUTERS_KEY }),
  })
}
