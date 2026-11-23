import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { enrollments, openhut, type Enrollment, type TailnetPeer } from '@/lib/openhut'
import { COMPUTERS_KEY } from '@/lib/query-keys'
import { toastError } from '@/lib/toast'

export type { Enrollment }

export const ENROLL_KEY = ['enrollments']

export function useEnrollments() {
  return useQuery<Enrollment[]>({ queryKey: ENROLL_KEY, queryFn: () => [], initialData: [], staleTime: Infinity })
}

export function followEnrollments(client: QueryClient) {
  const take = (list: Enrollment[]) => client.setQueryData<Enrollment[]>(ENROLL_KEY, list)
  void enrollments.list().then(take)
  enrollments.follow(take)
}

export function useEnroll() {
  const client = useQueryClient()
  return {
    start: (peer: TailnetPeer) => openhut.computers.add(peer).then(() => client.invalidateQueries({ queryKey: COMPUTERS_KEY }), toastError),
    dismiss: (dns: string) => void enrollments.dismiss(dns),
  }
}
