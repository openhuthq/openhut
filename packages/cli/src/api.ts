import * as z from 'zod/mini'
import { ApiError } from '@jakebox/common/api.ts'
import { session } from './credentials.ts'
import { signInAgain } from './oauth.ts'

export async function api<S extends z.ZodMiniType>({ path, schema, method = 'GET', body }: Call<S>): Promise<z.infer<S>> {
  const { url, accessToken } = await session()
  const res = await fetch(new URL(path, url), {
    method,
    headers: { authorization: `Bearer ${accessToken}`, ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
  }).catch(() => {
    throw new Error(`Can't reach ${url}. Check that JakeBox is running there.`)
  })
  const reply: unknown = await res.json().catch(() => undefined)
  if (res.status === 401) throw new Error(signInAgain(url))
  if (!res.ok) throw new Error(ApiError.safeParse(reply).data?.error.message ?? `${url} answered ${res.status}. Try again.`)
  const parsed = z.safeParse(schema, reply)
  if (!parsed.success) throw new Error(`${url} sent a reply this jakebox command doesn't understand. Update the CLI to the server's version.`)
  return parsed.data
}

export type Call<S> = { path: string; schema: S; method?: 'GET' | 'POST' | 'PATCH'; body?: object }
