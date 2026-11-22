import { RequestError, type Where } from '@openhut/client'
import { ApiError } from '@openhut/common/api.ts'
import { openhut } from '@/lib/openhut'

type Schema<T> = { safeParse: (data: unknown) => { success: true; data: T } | { success: false } }

export { RequestError }

export async function request<T>({ schema, method = 'GET', body, ...where }: Where & { schema: Schema<T>; path: string; method?: string; body?: unknown }): Promise<T> {
  const response = await openhut.fetch({ ...where, init: { method, ...payloadOf(body) } })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw failure(response.status, payload)
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new RequestError({ message: "OpenHut got an answer it doesn't understand. Update OpenHut and try again.", status: response.status })
  return parsed.data
}

export async function requestBlob(where: Where & { path: string }): Promise<Blob> {
  const response = await openhut.fetch(where)
  if (!response.ok) throw failure(response.status, await response.json().catch(() => null))
  return response.blob()
}

function payloadOf(body: unknown): RequestInit {
  if (body instanceof Blob) return { body, headers: { 'content-type': 'application/octet-stream' } }
  if (body === undefined) return {}
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
}

export function fieldError(error: Error | null, field: string) {
  return paramField(error) === field ? error?.message : undefined
}

export function formError(error: Error | null, fields: readonly string[]) {
  const field = paramField(error)
  if (!error || (field && fields.includes(field))) return undefined
  return error.message
}

function failure(status: number, payload: unknown) {
  const parsed = ApiError.safeParse(payload)
  if (!parsed.success) return new RequestError({ message: 'Something went wrong. Try again in a moment.', status })
  return new RequestError({ message: parsed.data.error.message, status, param: parsed.data.error.param })
}

function paramField(error: Error | null) {
  if (!(error instanceof RequestError)) return undefined
  return error.param?.match(/^\w+/)?.[0]
}
