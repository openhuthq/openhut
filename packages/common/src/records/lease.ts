import * as z from 'zod/mini'
import { RecordsError, type RecordsClient } from '../cloud/records.ts'
import { whereOf, type Opened } from './seal.ts'

export const LEASE_MS = 5 * 60_000
export const POLL_MS = 1000

const Lease = z.object({ device: z.string(), until: z.number() })
export type Lease = z.infer<typeof Lease>
export type Secret = Record<string, unknown>
type Clock = { now: () => number; sleep: (ms: number) => Promise<void> }

export async function refreshWithLease({ records, row, refresh, now = Date.now, sleep = pause }: {
  records: RecordsClient
  row: Opened
  refresh: (secret: Secret) => Promise<Secret>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<Opened> {
  const stale = tokensOf(row)
  let latest = row
  for (const _attempt of [1, 2]) {
    latest = await waitOut({ records, row: latest, clock: { now, sleep } })
    if (tokensOf(latest) !== stale) return latest
    const taken = await take({ records, row: latest, until: now() + LEASE_MS })
    if ('held' in taken) return finish({ records, held: taken.held, refresh })
    latest = taken.latest
  }
  throw new RecordsError({ status: 409, type: 'invalid_request_error', message: 'Another computer kept this connection busy. Try again in a moment.' })
}

export function leaseOf(row: Opened): Lease | null {
  return Lease.safeParse(secretOf(row).lease).data ?? null
}

async function take({ records, row, until }: { records: RecordsClient; row: Opened; until: number }): Promise<{ held: Opened } | { latest: Opened }> {
  const lease = { device: records.by, until }
  try {
    return { held: await records.put({ ...whereOf(row), current: row.ver, value: { ...row.value, vault: { ...secretOf(row), lease } } }) }
  } catch (error) {
    if (error instanceof RecordsError && error.current) return { latest: error.current }
    throw error
  }
}

async function finish({ records, held, refresh }: { records: RecordsClient; held: Opened; refresh: (secret: Secret) => Promise<Secret> }): Promise<Opened> {
  const { lease: _lease, ...secret } = secretOf(held)
  const store = (vault: Secret) => records.put({ ...whereOf(held), current: held.ver, value: { ...held.value, vault }, reapply: (latest) => ({ ...latest.value, vault }) })
  const fresh = await refresh(secret).catch(async (error: unknown) => {
    await store(secret).catch(() => null)
    throw error
  })
  return store(fresh)
}

async function waitOut({ records, row, clock }: { records: RecordsClient; row: Opened; clock: Clock }): Promise<Opened> {
  const deadline = clock.now() + LEASE_MS
  let latest = row
  while (busy({ row: latest, me: records.by, at: clock.now() }) && clock.now() < deadline) {
    await clock.sleep(POLL_MS)
    const next = await records.get(whereOf(latest))
    if (!next || next.deleted) throw new RecordsError({ status: 404, type: 'invalid_request_error', message: 'This connection was removed while it was being refreshed.' })
    latest = next
  }
  return latest
}

function busy({ row, me, at }: { row: Opened; me: string; at: number }): boolean {
  const lease = leaseOf(row)
  return Boolean(lease && lease.device !== me && lease.until > at)
}

function tokensOf(row: Opened): string {
  const { lease: _lease, ...secret } = secretOf(row)
  return JSON.stringify(secret)
}

function secretOf(row: Opened): Secret {
  const vault = row.value.vault
  if (typeof vault !== 'object' || vault === null || Array.isArray(vault)) throw new RecordsError({ status: 403, type: 'invalid_request_error', message: 'This device can’t open the connection’s secret.' })
  return Object.fromEntries(Object.entries(vault))
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
