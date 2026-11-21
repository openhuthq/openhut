import { useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OpenHutAgent } from '@openhut/client'
import { Cloud, CloudInvite, CloudInvitePreview, type CloudWorkspaceView, type CreateCloudInvite } from '@openhut/common/cloud/cloud.ts'
import { request } from '@/lib/api-client'
import { AGENTS_KEY } from '@/lib/query-keys'
import { nameOf, useCloud } from '@/features/cloud/api'

const ACTIVE_KEY = 'openhut.workspace'
const CHANGED = 'openhut:workspace'
const CLOUD_KEY = ['cloud']

export function workspaceName(workspace: CloudWorkspaceView): string {
  const owner = workspace.members.find((member) => member.role === 'owner')
  return workspace.name ?? `${nameOf(owner?.email ?? '')}’s workspace`
}

export function peopleNote(workspace: CloudWorkspaceView): string {
  if (workspace.waiting) return 'Waiting for a key…'
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

export function useWorkspaces(): { all: CloudWorkspaceView[]; active: CloudWorkspaceView | undefined; email: string | null } {
  const cloud = useCloud().data
  const id = useSyncExternalStore(subscribe, chosen)
  const all = cloud?.status === 'off' ? [] : cloud?.workspaces ?? []
  return { all, active: all.find((each) => each.id === id) ?? all.find((each) => each.home), email: cloud?.email ?? null }
}

export function inWorkspace({ agent, active }: { agent: Pick<OpenHutAgent, 'workspace' | 'computer'>; active: CloudWorkspaceView | undefined }): boolean {
  if (!active) return true
  if (agent.computer !== 'local') return active.home
  return active.home ? !agent.workspace || agent.workspace === active.id : agent.workspace === active.id
}

export function useInvite() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCloudInvite) => request({ schema: CloudInvite, computer: 'local', path: '/api/invitations/cloud', method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: CLOUD_KEY }),
  })
}

export function useInvitePreview(link: string, enabled: boolean) {
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

export function useSetRole() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, email, role }: { id: string; email: string; role: 'admin' | 'member' }) => request({ schema: Cloud, computer: 'local', path: `/api/cloud/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(email)}`, method: 'PATCH', body: { role } }),
    onSuccess: (cloud) => client.setQueryData(CLOUD_KEY, cloud),
  })
}
