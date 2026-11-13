import { useInfiniteQuery } from '@tanstack/react-query'
import * as z from 'zod/mini'
import { ApiError, List } from '@jakebox/common/api.ts'
import { Install, Release } from '@jakebox/common/console/console.ts'

const ReleaseList = List(Release)
const InstallList = List(Install)
const PAGE = 50

export function useReleases() {
  return useInfiniteQuery({
    queryKey: ['releases'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => get({ schema: ReleaseList, path: pathOf({ collection: 'releases', after: pageParam }) }),
    getNextPageParam: nextPage,
  })
}

export function useInstalls(publishKey: string) {
  return useInfiniteQuery({
    queryKey: ['installs', publishKey],
    enabled: publishKey !== '',
    initialPageParam: '',
    queryFn: ({ pageParam }) => get({ schema: InstallList, path: pathOf({ collection: 'installs', after: pageParam }), publishKey }),
    getNextPageParam: nextPage,
  })
}

function pathOf({ collection, after }: { collection: string; after: string }): string {
  const query = new URLSearchParams({ limit: String(PAGE), ...(after && { startingAfter: after }) })
  return `/api/${collection}?${query}`
}

function nextPage(page: { hasMore: boolean; data: { id: string }[] }): string | undefined {
  return page.hasMore ? page.data.at(-1)?.id : undefined
}

async function get<S extends z.ZodMiniType>({ schema, path, publishKey }: { schema: S; path: string; publishKey?: string }): Promise<z.infer<S>> {
  const response = await fetch(path, { headers: publishKey ? { authorization: `Bearer ${publishKey}` } : {} })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(ApiError.safeParse(payload).data?.error.message ?? `The console answered ${response.status}. Try again in a moment.`)
  const parsed = z.safeParse(schema, payload)
  if (!parsed.success) throw new Error('The console sent a reply this page doesn\'t understand. Reload the page to get the latest version.')
  return parsed.data
}
