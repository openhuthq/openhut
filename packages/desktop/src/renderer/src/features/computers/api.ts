import { useMutation, useQuery } from '@tanstack/react-query'
import { useAgents } from '@/features/agents/api'
import { Admin, Update } from '@openhut/common/admin/admin.ts'
import { request } from '@/lib/api-client'
import { openhut, type Computer, type Features } from '@/lib/openhut'
import { WORDS } from '@/lib/platform'
import { COMPUTERS_KEY } from '@/lib/query-keys'

export type ComputerAdmin = { computer: Computer; admin: Admin | undefined }

const ADMINS_KEY = [...COMPUTERS_KEY, 'admins']
const ANYWHERE: Features = { whatsapp: true, browser: true }

export function useComputers() {
  return useQuery({ queryKey: COMPUTERS_KEY, queryFn: () => openhut.computers.list() })
}

export function useFeatures(agentId: string): Features {
  const here = useAgents().data?.find((each) => each.id === agentId)?.runsHere ?? true
  const local = useComputers().data?.[0]?.features ?? { whatsapp: false, browser: false }
  // ponytail: an agent that runs elsewhere is assumed to have both; the runner answers 409 if not. P1's runner beat brings real features.
  return here ? local : ANYWHERE
}

export function useComputerAdmins() {
  const computers = useComputers().data
  return useQuery({
    queryKey: [...ADMINS_KEY, computers?.map((computer) => `${computer.id}:${computer.online}`)],
    queryFn: (): Promise<ComputerAdmin[]> => Promise.all((computers ?? []).map(async (computer) => ({ computer, admin: computer.online ? await adminOf(computer.id) : undefined }))),
    enabled: !!computers,
  })
}

export function runsOnNote(computer: Computer) {
  if (!computer.online) return 'Offline'
  if (computer.id !== 'local') return 'Sealed in its own box · always on'
  return `${WORDS.sandboxed ? 'Sealed in its own box' : 'With your access'} · while this computer is awake`
}

export function nameOf({ computers, id }: { computers: Computer[] | undefined; id: string }) {
  return computers?.find((each) => each.id === id)?.name ?? id
}

export function startUpdate(computer: { id: string; name: string }): Promise<Update> {
  return request({ schema: Update, path: computer.id === 'local' ? '/api/updates' : `/c/${computer.id}/api/updates`, method: 'POST' })
}

export function adminOf(computer: string) {
  return request({ schema: Admin, path: computer === 'local' ? '/api/admin' : `/c/${computer}/api/admin` }).catch(() => undefined)
}

export function useUpdateComputer() {
  return useMutation({ mutationFn: (computer: { id: string; name: string }) => startUpdate(computer) })
}
