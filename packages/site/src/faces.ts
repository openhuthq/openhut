import { FACE_MAX_BYTES, isFacePng } from '@openhut/common/agents/face.ts'

// An agent's face for its GitHub footer: a 64×64 PNG stored in the releases bucket (dl.openhut.dev) under its own sha256,
// so a name can't be overwritten with another picture and says nothing about the install that sent it.
const PUBLIC = 'https://dl.openhut.dev'

type Bucket = {
  head: (key: string) => Promise<unknown>
  put: (key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string; cacheControl: string } }) => Promise<unknown>
}
type RateLimit = { limit: (x: { key: string }) => Promise<{ success: boolean }> }
export type FacesEnv = { DL?: Bucket; FACES_LIMIT?: RateLimit }

export async function saveFace({ request, env }: { request: Request; env: FacesEnv }): Promise<Response> {
  if (!env.DL) return failure(503, 'Faces are not stored here.')
  const allowed = await env.FACES_LIMIT?.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' })
  if (allowed && !allowed.success) return failure(429, 'Too many faces from this address. Try again in a minute.')
  if (Number(request.headers.get('content-length') ?? 0) > FACE_MAX_BYTES) return failure(413, 'Send a 64×64 PNG under 20 KB.')
  const bytes = await request.arrayBuffer()
  if (!isFacePng(new Uint8Array(bytes))) return failure(400, 'Send a 64×64 PNG under 20 KB.')
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const key = `a/${sha}.png`
  if (!await env.DL.head(key)) await env.DL.put(key, bytes, { httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' } })
  return Response.json({ url: `${PUBLIC}/${key}` }, { status: 201 })
}

function failure(status: number, message: string): Response {
  return Response.json({ error: { type: 'invalid_request_error', message } }, { status })
}
