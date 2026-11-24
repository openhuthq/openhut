import { RequestError } from '@/lib/openhut'

export { request, requestBlob, RequestError } from '@/lib/openhut'

export function fieldError(error: Error | null, field: string) {
  return paramField(error) === field ? error?.message : undefined
}

export function formError(error: Error | null, fields: readonly string[]) {
  const field = paramField(error)
  if (!error || (field && fields.includes(field))) return undefined
  return error.message
}

function paramField(error: Error | null) {
  if (!(error instanceof RequestError)) return undefined
  return error.param?.match(/^\w+/)?.[0]
}
