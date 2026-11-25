import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Invite, Person, Session, Setup } from '@openhut/common/team/team.ts'
import * as z from 'zod/mini'
import { request } from '@/lib/api-client'
import { navigate } from '@/lib/router'

const Reset = z.object({ object: z.literal('password_reset') })

export function useSetup() {
  return useQuery({ queryKey: ['setup'], queryFn: () => request({ schema: Setup, path: '/api/setup' }) })
}

export function useInviteLink(token: string) {
  return useQuery({ queryKey: ['invite', token], queryFn: () => request({ schema: Invite, path: `/api/invites/${encodeURIComponent(token)}` }), retry: false })
}

function useSignedIn<T>(mutationFn: (body: T) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation({ mutationFn, onSuccess: () => { client.clear(); navigate('/', true) } })
}

export const useCreatePerson = () => useSignedIn((body: { address: string; email: string; password: string } | { inviteToken: string; name: string; email: string; password: string }) => request({ schema: Person, path: '/api/people', method: 'POST', body }))

export const useCreateSession = () => useSignedIn((body: { email: string; password: string }) => request({ schema: Session, path: '/api/sessions', method: 'POST', body }))

export const useFinishReset = () => useSignedIn((body: { token: string; password: string }) => request({ schema: Session, path: '/api/password-resets', method: 'PATCH', body }))

export function useStartReset() {
  return useMutation({ mutationFn: (body: { email: string }) => request({ schema: Reset, path: '/api/password-resets', method: 'POST', body }) })
}

export function useSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request({ schema: z.object({ deleted: z.boolean() }), path: '/api/sessions/current', method: 'DELETE' }),
    onSuccess: () => { client.clear(); navigate('/login', true) },
  })
}
