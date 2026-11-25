import { createContext, use, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cloud, CloudInvite, type CloudWorkspaceView, type CreateCloudInvite, type Role } from '@openhut/common/cloud/cloud.ts'
import type { Me } from '@openhut/common/cloud/v1/identity.ts'
import { request, requestBlob } from '@/lib/api-client'
import { AGENTS_KEY } from '@/lib/query-keys'
import { ACTIVE_KEY, REMOTE, remote } from '@/lib/remote'

const CHANGED = 'openhut:workspace'
const CLOUD_KEY = ['cloud']

export type Team = { id: string; name: string; website: string | null; note: string }

const peopleNote = (people: number) => people === 1 ? 'Just you' : `${people} people`

export function teamsOf({ me, here, active }: { me: Me | null | undefined; here: CloudWorkspaceView[]; active: string }): Team[] {
  const site = (id: string) => here.find((each) => each.id === id)?.website ?? null
  if (!me) return here.map((each) => ({ id: each.id, name: each.name, website: each.website, note: each.waiting ? 'Joining…' : peopleNote(each.members.length) }))
  const listed = me.workspaces.filter((each) => each.access === 'listed').map((each) => ({ id: each.id, name: here.find((one) => one.id === each.id)?.name ?? each.name, website: site(each.id), note: peopleNote(each.people) }))
  const unstarted = me.unstarted.filter((each) => each.id !== me.home || each.id === active).map((each) => ({ id: each.id, name: each.name, website: null, note: 'Just you' }))
  return [...listed, ...unstarted]
}

const ME_KEY = ['cloud-me']

export function useTeams(): Team[] {
  const { all, active } = useWorkspaces()
  const me = useQuery({ queryKey: ME_KEY, queryFn: remote.me, enabled: REMOTE }).data
  return teamsOf({ me, here: all, active: active.id })
}

export function useCreateTeam() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: remote.createTeam,
    onSuccess: async (team) => {
      await remote.startCloud(team.id)
      await client.invalidateQueries({ queryKey: ME_KEY })
      chooseWorkspace(team.id)
    },
  })
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
