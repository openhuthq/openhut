import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { TailnetPeer } from '@openhut/client'
import { enrollments, openhut, type Enrollment as Shared } from '@/lib/openhut'
import { COMPUTERS_KEY } from '@/lib/query-keys'

export type Enrollment = Shared

export const ENROLL_KEY = ['enrollments']

export function useEnrollments() {
  return useQuery<Enrollment[]>({ queryKey: ENROLL_KEY, queryFn: () => [], initialData: [], staleTime: Infinity })
}

export function followEnrollments(client: QueryClient) {
  const take = (list: Shared[]) => client.setQueryData<Enrollment[]>(ENROLL_KEY, list)
  void enrollments.list().then(take)
  enrollments.follow(take)
}

export function useEnroll() {
  const client = useQueryClient()
  return {
    start: (peer: TailnetPeer) => openhut.computers.add(peer).then(() => client.invalidateQueries({ queryKey: COMPUTERS_KEY }), () => undefined),
    dismiss: (dns: string) => void enrollments.dismiss(dns),
  }
}
