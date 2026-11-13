import { useQuery } from '@tanstack/react-query'
import { ApiError, List } from '@jakebox/common/api.ts'
import { Install, Release } from '@jakebox/common/console/console.ts'

const RELEASES = List(Release)
const INSTALLS = List(Install)

export function useReleases() {
  return useQuery({ queryKey: ['releases'], queryFn: () => get({ schema: RELEASES, path: '/api/releases?limit=100' }) })
}

export function useInstalls(publishKey: string) {
  return useQuery({ queryKey: ['installs', publishKey], enabled: publishKey !== '', queryFn: () => get({ schema: INSTALLS, path: '/api/installs?limit=100', publishKey }) })
}

async function get<T>({ schema, path, publishKey }: { schema: { parse: (data: unknown) => T }; path: string; publishKey?: string }): Promise<T> {
  const response = await fetch(path, { headers: publishKey ? { authorization: `Bearer ${publishKey}` } : {} })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(ApiError.safeParse(payload).data?.error.message ?? `The console answered ${response.status}. Try again in a moment.`)
  return schema.parse(payload)
}
