import type { webcrypto } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'

const API = new URL('../../../../../private/api/src/', import.meta.url)
type Listening = { listen: (input: { port: number; host: string }) => Promise<string>; close: () => Promise<void> }

export const hasCloud = existsSync(new URL('app.ts', API))

export async function bootCloud(): Promise<{ url: string; close: () => Promise<void> }> {
  const port = await new Promise<number>((done) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address() as AddressInfo
      probe.close(() => done(free))
    })
  })
  const url = `http://127.0.0.1:${port}`
  const runtimePort = process.env.PORT
  for (const name of ['DATABASE_URL', 'OPENHUT_API_DATA', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) delete process.env[name]
  Object.assign(process.env, { PORT: String(port), API_URL: url, DEV_SIGN_IN: '1', BETTER_AUTH_SECRET: 'test-better-auth-secret-0123456789abcdef' })
  const { migrate } = await import(new URL('platform/db.ts', API).href) as { migrate: () => Promise<void> }
  await migrate()
  const { app } = await import(new URL('app.ts', API).href) as { app: Listening }
  await app.listen({ port, host: '127.0.0.1' })
  if (runtimePort === undefined) delete process.env.PORT
  else process.env.PORT = runtimePort
  process.env.OPENHUT_API_URL = url
  return { url, close: () => app.close() }
}

export async function devSignIn({ authorizationUrl, email }: { authorizationUrl: string; email: string }): Promise<string> {
  const page = await (await fetch(authorizationUrl)).text()
  const link = new RegExp(`href="([^"]+)">${email}<`).exec(page)?.[1]?.replaceAll('&amp;', '&')
  if (!link) throw new Error(`The dev sign-in page has no link for ${email}.`)
  const back = await fetch(link, { redirect: 'manual' })
  const last = new URL(back.headers.get('location') ?? 'http://none/')
  const location = new URL(last.searchParams.get('to') ?? last)
  return `${location.pathname}${location.search}`
}

export async function browserKey({ url }: { url: string }) {
  const { openhutCloud } = await import('@openhut/common/cloud/openhut-cloud.ts')
  const { toBase64 } = await import('@openhut/common/vault/public.ts')
  const signing = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as webcrypto.CryptoKeyPair
  const tunnel = await crypto.subtle.generateKey('X25519', false, ['deriveBits']) as webcrypto.CryptoKeyPair
  const raw = async (key: webcrypto.CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', key))
  const device = toBase64(new Uint8Array([...await raw(signing.publicKey), ...await raw(tunnel.publicKey)]))
  const kept = new Map<string, unknown>()
  const store = { get: async <T>(key: string) => kept.get(key) as T | undefined, set: async (key: string, value: unknown) => { kept.set(key, value) } }
  const key = { id: async () => device, sign: async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', signing.privateKey, Uint8Array.from(bytes))), noise: async () => ({ publicKey: await raw(tunnel.publicKey), secretKey: new Uint8Array(32) }) }
  const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, { ...init, headers: { ...init?.headers as Record<string, string>, origin: WEB } })
  return { device, client: openhutCloud.device({ url, key, store, fetch }), asComputer: openhutCloud.computer({ url, key, store, fetch }) }
}

export async function webBrowser({ url, email }: { url: string; email: string }) {
  const { device, client, asComputer } = await browserKey({ url })
  const started = await client.signIn({ google: { returnTo: `${WEB}/signed-in` } })
  const back = new URL(await devSignIn({ authorizationUrl: started.object === 'redirect' ? started.url : '', email }), WEB)
  await client.signIn({ googleCode: back.searchParams.get('code') ?? '', state: back.searchParams.get('state') ?? '' })
  return { device, client, asComputer }
}

const WEB = 'https://app.openhut.dev'
