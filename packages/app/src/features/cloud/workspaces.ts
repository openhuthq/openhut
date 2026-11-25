import { createContext, use, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cloud, CloudInvite, CloudInvitePreview, type CloudWorkspaceView, type CreateCloudInvite, type Role } from '@openhut/common/cloud/cloud.ts'
import { request, requestBlob } from '@/lib/api-client'
import { AGENTS_KEY } from '@/lib/query-keys'

const ACTIVE_KEY = 'openhut.workspace'
const CHANGED = 'openhut:workspace'
const CLOUD_KEY = ['cloud']

export function peopleNote(workspace: CloudWorkspaceView): string {
  if (workspace.waiting) return 'Joining…'
  return workspace.members.length === 1 ? 'Just you' : `${workspace.members.length} people`
}

export function chooseWorkspace(id: string) {
  try { localStorage.setItem(ACTIVE_KEY, id) } catch { return }
  dispatchEvent(new Event(CHANGED))
}

function chosen(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY) } catch { return null }
}

function subscribe(listener: () => void) {
  addEventListener(CHANGED, listener)
  addEventListener('storage', listener)
  return () => {
    removeEventListener(CHANGED, listener)
    removeEventListener('storage', listener)
  }
}

export type Gated = { cloud: Cloud; active: CloudWorkspaceView }
export const GateContext = createContext<Gated | null>(null)

export function useGate(): Gated {
  const gated = use(GateContext)
  if (!gated) throw new Error('This screen shows only after sign-in.')
  return gated
}

export function useChosen(): string | null {
  return useSyncExternalStore(subscribe, chosen)
}

export function activeOf({ workspaces, chosen }: { workspaces: CloudWorkspaceView[]; chosen: string | null }): CloudWorkspaceView | undefined {
  return workspaces.find((each) => each.id === chosen) ?? workspaces.find((each) => each.home) ?? workspaces[0]
}

export function useWorkspaces(): { all: CloudWorkspaceView[]; active: CloudWorkspaceView; email: string | null } {
  const { cloud, active } = useGate()
  return { all: cloud.workspaces, active, email: cloud.email }
}

export function useInvite() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCloudInvite) => request({ schema: CloudInvite, computer: 'local', path: '/api/invitations/cloud', method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: CLOUD_KEY }),
  })
}

export function useInvitePreview({ link, enabled }: { link: string; enabled: boolean }) {
  return useQuery({ queryKey: ['cloud-invite', link], queryFn: () => request({ schema: CloudInvitePreview, computer: 'local', path: '/api/invitations/cloud/previews', method: 'POST', body: { link } }), enabled, retry: false, staleTime: Infinity })
}

export function useJoin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (link: string) => request({ schema: Cloud, computer: 'local', path: '/api/invitations/cloud/joins', method: 'POST', body: { link } }),
    onSuccess: (cloud) => {
      client.setQueryData(CLOUD_KEY, cloud)
      void client.invalidateQueries({ queryKey: AGENTS_KEY })
    },
  })
}

export function useRename() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => request({ schema: Cloud, computer: 'local', path: `/api/cloud/workspaces/${encodeURIComponent(id)}`, method: 'PATCH', body: { name } }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function useSetWebsite() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, website }: { id: string; website: string | null }) => request({ schema: Cloud, computer: 'local', path: `/api/cloud/workspaces/${encodeURIComponent(id)}`, method: 'PATCH', body: { website } }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

export function useTeamIcon({ id, website }: { id: string; website: string | null }) {
  return useQuery({
    queryKey: ['team-icon', id, website],
    queryFn: async () => URL.createObjectURL(await requestBlob({ computer: 'local', path: `/api/cloud/workspaces/${encodeURIComponent(id)}/icon` })),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  }).data
}

export function useSetRole() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, email, role }: { id: string; email: string; role: Role }) => request({ schema: Cloud, computer: 'local', path: `/api/cloud/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(email)}`, method: 'PATCH', body: { role } }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}

function useCloudCall<T>(call: (input: T) => Promise<Cloud>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: call,
    onSuccess: (cloud) => {
      client.setQueryData(CLOUD_KEY, cloud)
      void client.invalidateQueries({ queryKey: AGENTS_KEY })
    },
  })
}

const room = (id: string) => `/api/cloud/workspaces/${encodeURIComponent(id)}`

export const useRemoveMember = () => useCloudCall(({ id, email }: { id: string; email: string }) => request({ schema: Cloud, computer: 'local', path: `${room(id)}/members/${encodeURIComponent(email)}`, method: 'DELETE' }))

export const useRevokeInvite = () => useCloudCall(({ id, email }: { id: string; email: string }) => request({ schema: Cloud, computer: 'local', path: `${room(id)}/invites/${encodeURIComponent(email)}`, method: 'DELETE' }))

export const useRemoveDevice = () => useCloudCall(({ id, device }: { id: string; device: string }) => request({ schema: Cloud, computer: 'local', path: `${room(id)}/devices/${encodeURIComponent(device)}`, method: 'DELETE' }))

export const useDeleteWorkspace = () => useCloudCall(({ id, name }: { id: string; name: string }) => request({ schema: Cloud, computer: 'local', path: room(id), method: 'DELETE', body: { name } }))

export const useDeleteData = () => useCloudCall(() => request({ schema: Cloud, computer: 'local', path: '/api/cloud', method: 'DELETE' }))

export const useRotated = () => useCloudCall(() => request({ schema: Cloud, computer: 'local', path: '/api/cloud/rotations', method: 'DELETE' }))
