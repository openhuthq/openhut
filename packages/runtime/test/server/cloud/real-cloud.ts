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
  const location = new URL(back.headers.get('location') ?? 'http://none/')
  return `${location.pathname}${location.search}`
}
