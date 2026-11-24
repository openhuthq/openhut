import { boxKey, fromBase64, identity, sign, toBase64 } from '@openhut/common/vault/public.ts'
import { CloudError, openhutCloud, type Reply } from '@openhut/common/cloud/openhut-cloud.ts'
import type { Session } from '@openhut/common/cloud/v1/identity.ts'
import { keyStore } from '../cloud/key-store.ts'
import { config } from './config.ts'
import { HttpError } from './http-error.ts'

const held = new Set<string>()

const device = async () => identity(fromBase64((await keyStore.read()).device))

const store = {
  async get<T>(key: string): Promise<T | undefined> {
    const stored = keyStore.current()
    const who = stored?.account ?? stored?.locked
    if (key !== 'session' || !stored?.session) return undefined
    const session: Session = { object: 'session', token: stored.session.token, refreshToken: stored.session.refresh ?? '', sub: who?.sub ?? '', email: who?.email ?? '', device: toBase64((await device()).publicKey), expiresAt: stored.session.expiresAt }
    return session as T
  },
  async set(key: string, value: unknown): Promise<void> {
    if (key !== 'session') return
    const session = value as Session | undefined
    await keyStore.write({ ...await keyStore.read(), session: session && { token: session.token, refresh: session.refreshToken, expiresAt: session.expiresAt } })
  },
}

export const cloud = openhutCloud.computer({
  url: () => config.apiUrl,
  store,
  key: {
    id: async () => toBase64((await device()).publicKey),
    sign: async (bytes) => sign({ secret: (await device()).secret, bytes: Uint8Array.from(bytes) }),
    noise: async () => boxKey((await device()).secret),
  },
})

export function hold({ workspace, on }: { workspace: string; on: boolean }): void {
  if (on) held.add(workspace)
  else held.delete(workspace)
}

export function sending(workspace: string): void {
  if (held.has(workspace)) throw new HttpError(409, 'This team’s history doesn’t match another member’s, so no keys go out until it does. Check with your teammates.')
}

export function ok(reply: Reply, message: string): Reply {
  if (reply.status === 0) throw new HttpError(502, 'OpenHut Cloud didn’t answer. Check this computer’s internet connection.')
  if (reply.status < 200 || reply.status >= 300) throw new HttpError(502, message)
  return reply
}

export function fromCloud(error: unknown): never {
  if (error instanceof CloudError) throw new HttpError(502, error.message)
  throw error
}
