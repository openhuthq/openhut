import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import * as z from 'zod/mini'
import { refresh } from './oauth.ts'

export const CREDENTIALS_FILE = join(homedir(), '.config', 'jakebox', 'credentials.json')
const REFRESH_EARLY_MS = 60_000
const Stored = z.object({ url: z.string(), clientId: z.string(), accessToken: z.string(), refreshToken: z.string(), expiresAt: z.iso.datetime() })

export function load(): Credentials {
  const credentials = stored()
  if (!credentials) throw new Error('Sign in first with jakebox login <url>, like jakebox login https://jakebox.example.com.')
  return credentials
}

export function stored(): Credentials | undefined {
  try {
    return Stored.safeParse(JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'))).data
  } catch {
    return undefined
  }
}

export function save(credentials: Credentials): void {
  mkdirSync(dirname(CREDENTIALS_FILE), { recursive: true, mode: 0o700 })
  writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  chmodSync(CREDENTIALS_FILE, 0o600)
}

export async function session(): Promise<Credentials> {
  const credentials = load()
  if (Date.parse(credentials.expiresAt) - REFRESH_EARLY_MS > Date.now()) return credentials
  const renewed = await refresh(credentials)
  save(renewed)
  return renewed
}

export type Credentials = z.infer<typeof Stored>
