import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import * as z from 'zod/mini'
import type { Credentials } from './credentials.ts'

const CLIENT_NAME = 'JakeBox CLI'
const TEXT = { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }
const Metadata = z.object({ authorization_endpoint: z.url(), token_endpoint: z.url(), registration_endpoint: z.url() })
const Registration = z.object({ client_id: z.string() })
const Tokens = z.object({ access_token: z.string(), refresh_token: z.string(), expires_in: z.number() })
const Failure = z.object({ error: z.string(), error_description: z.optional(z.string()) })

export function pkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: challengeOf(verifier) }
}

export const challengeOf = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

export const signInAgain = (url: string): string => `Your sign-in to ${url} has ended. Run jakebox login ${url} again.`

export async function signIn(url: string): Promise<Credentials> {
  const endpoints = await endpointsOf(url)
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const redirectUri = `http://127.0.0.1:${address.port}/callback`
    const registration = JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [redirectUri] })
    const registered = await oauth(url, endpoints.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: registration })
    const { client_id: clientId } = Registration.parse(registered)
    const { verifier, challenge } = pkce()
    const state = randomBytes(16).toString('base64url')
    const authorize = new URL(endpoints.authorization_endpoint)
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state }).toString()
    const approved = approval(server, state, url)
    console.log(`Open this page to sign in to JakeBox:\n\n  ${authorize}\n\nWaiting for you to allow the JakeBox CLI there. Press Ctrl-C to cancel.`)
    if (process.stdout.isTTY) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [authorize.href], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: await approved, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri })
    return credentialsOf(url, clientId, Tokens.parse(await oauth(url, endpoints.token_endpoint, { method: 'POST', body: form })))
  } finally {
    server.close()
  }
}

export async function refresh({ url, clientId, refreshToken }: Credentials): Promise<Credentials> {
  const { token_endpoint } = await endpointsOf(url)
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId })
  return credentialsOf(url, clientId, Tokens.parse(await oauth(url, token_endpoint, { method: 'POST', body: form })))
}

async function endpointsOf(url: string): Promise<z.infer<typeof Metadata>> {
  const metadata = Metadata.safeParse(await oauth(url, new URL('/.well-known/oauth-authorization-server', url), {}))
  if (!metadata.success) throw new Error(`${url} doesn't look like a JakeBox server. Check the address.`)
  return metadata.data
}

async function oauth(url: string, endpoint: string | URL, init: RequestInit): Promise<unknown> {
  const res = await fetch(endpoint, init).catch(() => {
    throw new Error(`Can't reach ${url}. Check the address and that JakeBox is running there.`)
  })
  const body: unknown = await res.json().catch(() => undefined)
  if (res.ok) return body
  const failure = Failure.safeParse(body).data
  if (failure?.error === 'invalid_grant') throw new Error(signInAgain(url))
  throw new Error(failure?.error_description ?? `${url} answered ${res.status}. Check that the address is a JakeBox server.`)
}

function approval(server: Server, state: string, url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const callback = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (callback.pathname !== '/callback') return res.writeHead(404, TEXT).end()
      const code = callback.searchParams.get('state') === state ? callback.searchParams.get('code') : null
      if (code) {
        res.writeHead(200, TEXT).end('Signed in to JakeBox. Close this tab and go back to the terminal.')
        return resolve(code)
      }
      res.writeHead(400, TEXT).end('JakeBox sign-in failed. Go back to the terminal to see why.')
      const denied = callback.searchParams.get('error') === 'access_denied'
      reject(new Error(denied ? `You didn't allow the JakeBox CLI. Run jakebox login ${url} to try again.` : `The browser came back without a sign-in code. Run jakebox login ${url} to try again.`))
    })
  })
}

function credentialsOf(url: string, clientId: string, tokens: z.infer<typeof Tokens>): Credentials {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  return { url, clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt }
}

export type Pkce = { verifier: string; challenge: string }
