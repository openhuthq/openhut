import { RequestError } from '@openhut/client'
import { ApiError } from '@openhut/common/api.ts'

type Schema<T> = { safeParse: (data: unknown) => { success: true; data: T } | { success: false } }

export { RequestError }

export async function request<T>({ schema, path, method = 'GET', body }: { schema: Schema<T>; path: string; method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, { method, ...payloadOf(body) })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw failure(response.status, payload)
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new RequestError({ message: "The server sent an answer this page doesn't understand. Reload the page and try again.", status: response.status })
  return parsed.data
}

export async function requestBlob(path: string): Promise<Blob> {
  const response = await fetch(path)
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
  if (!parsed.success) return new RequestError({ message: `The server answered ${status}. Try again in a moment.`, status })
  return new RequestError({ message: parsed.data.error.message, status, param: parsed.data.error.param })
}

function paramField(error: Error | null) {
  if (!(error instanceof RequestError)) return undefined
  return error.param?.match(/^\w+/)?.[0]
}
