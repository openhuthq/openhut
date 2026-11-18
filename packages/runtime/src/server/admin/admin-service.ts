import * as z from 'zod/mini'
import { MIN_APP_VERSION, type Admin, type CodexSignIn, type CreateExport, type Export, type Health, type SeatSignIn, type SeatUsage, type Update, type UpdateAdmin } from '@openhut/common/admin/admin.ts'
import { ConnectionKind, type Connection } from '@openhut/common/connections/connection.ts'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError } from '../platform/http-error.ts'
import { createHash } from 'node:crypto'
import { agentd, containerStates, features, type LastUpdate } from '../platform/agentd.ts'
import { settings } from '../platform/settings.ts'
import { record, setUsageData } from '../platform/events.ts'
import { newId, openSealed, sealFor, transferPublicKey } from '../platform/secrets.ts'
import { codex } from '../integrations/codex/codex.ts'
import { connectionService } from '../connections/connection-service.ts'
import { providerService } from '../models/provider-service.ts'
import type { Caller } from '../team/identity.ts'
import { seatSignIn } from './seat-sign-in.ts'
import { seatLimits } from './seat-limits.ts'

const LATEST_TTL_MS = 60_000
const LATEST_TIMEOUT_MS = 10_000
const BUILD_LINE = /^OPENHUT_BUILD="([\w.-]+)"$/m
const SEMVER = /^\d+\.\d+\.\d+$/
const UPDATE_GRACE_MS = 20_000
const UPDATE_LIMIT_MS = 45 * 60_000
const WEEK_MS = 7 * 24 * 60 * 60_000
const StoredUpdate = z.object({ from: z.string(), to: z.string(), startedAt: z.string() })
const Transfer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('connection'), kind: ConnectionKind, name: z.string(), account: z.string(), config: z.unknown() }),
  z.object({ type: z.literal('claude'), token: z.string(), at: z.string() }),
  z.object({ type: z.literal('codex'), tokens: z.object({ accessToken: z.string(), refreshToken: z.string() }), at: z.string() }),
])
type Transfer = z.infer<typeof Transfer>
const CODEX_SIGN_IN_MS = 15 * 60_000
const codexSignIns = new Map<string, { deviceAuthId: string; userCode: string; until: number }>()
let latest: { build: string | null; sha256: string; at: number } = { build: null, sha256: '', at: 0 }

export const adminService = {
  async health(): Promise<Health> {
    return (await probe()).health
  },

  async status(): Promise<Admin> {
    const [{ health, installing, last }, states, agents, latestBuild, available] = await Promise.all([probe(), containerStates(), db.selectFrom('agent').select('id').execute(), adminService.latestBuild(), features()])
    return {
      object: 'admin',
      seat: { set: !!settings.seatToken(), mode: config.modelMode, updatedAt: settings.seatAt() },
      codex: { set: !!settings.codexTokens(), updatedAt: settings.codexAt() },
      server: {
        version: health.version, build: health.build, latestBuild, updateAvailable: isNewer({ latest: latestBuild, current: health.build }), update: await currentUpdate({ installing, last }), healthy: health.ok, agentd: health.agentd, firewall: health.firewall,
        running: agents.filter((agent) => states?.[agent.id] === 'running').length, total: agents.length,
      },
      tailnetUrl: settings.tailnetUrl() ?? null,
      google: { clientId: settings.googleClient()?.clientId ?? null, redirectUri: connectionService.redirectUrl() },
      usageData: settings.usageData(),
      publicKey: transferPublicKey,
      features: available,
      minAppVersion: MIN_APP_VERSION,
    }
  },

  async exportSealed({ actor, publicKey, connectionId, subscription }: { actor: Caller } & CreateExport): Promise<Export> {
    const transfer = await transferOf({ actor, connectionId, subscription })
    const sealed = attempt(() => sealFor({ publicKey, text: JSON.stringify(transfer) }))
    if (!sealed) throw new HttpError(400, 'That public key isn\'t one an OpenHut computer gave. Send the publicKey from its GET /api/admin.', { param: 'publicKey' })
    record({ action: 'admin.exported', actor, target: { type: 'admin', id: 'install', what: transfer.type, connectionId: connectionId ?? null } })
    return { object: 'export', sealed }
  },

  async importSealed({ actor, sealed }: { actor: Caller; sealed: string }): Promise<Connection | Admin> {
    const transfer = z.safeParse(Transfer, parseJson(attempt(() => openSealed(sealed))))
    if (!transfer.success) throw new HttpError(400, 'This wasn\'t sealed for this computer. Export it again with this computer\'s publicKey.', { param: 'sealed' })
    const { data } = transfer
    record({ action: 'admin.imported', actor, target: { type: 'admin', id: 'install', what: data.type } })
    if (data.type === 'connection') return connectionService.save({ actor, kind: data.kind, name: data.name, config: data.config, account: data.account, signIn: false })
    if (data.type === 'claude') {
      await settings.setSeatToken(data.token)
      await settings.setSeatAt(data.at)
    } else {
      await settings.setCodexTokens(data.tokens)
      await settings.setCodexAt(data.at)
    }
    return adminService.status()
  },

  async seatUsage(): Promise<SeatUsage> {
    if (!settings.seatToken()) throw new HttpError(409, 'No Claude seat is connected, so there\'s no usage to show.')
    const windows = seatLimits.latest()
    const resetsAt = windows.find((window) => window.kind === 'seven_day')?.resetsAt
    const since = (resetsAt ? Date.parse(resetsAt) : Date.now()) - WEEK_MS
    const [{ usage }, agents] = await Promise.all([agentd.usage({ since: since / 1000 }), db.selectFrom('agent').select(['id', 'name']).orderBy('created_at').execute()])
    return {
      object: 'seat_usage', windows, since: new Date(since).toISOString(),
      agents: agents.map((agent) => ({ agentId: agent.id, agentName: agent.name, costUsd: usage[agent.id] ?? 0 })),
    }
  },

  async latestBuild(): Promise<string | null> {
    if (config.socket) return null
    if (Date.now() - latest.at < LATEST_TTL_MS) return latest.build
    const script = await fetch(config.releaseUrl, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) })
      .then((response) => response.ok ? response.text() : '').catch(() => '')
    latest = { build: BUILD_LINE.exec(script)?.[1] ?? null, sha256: createHash('sha256').update(script).digest('hex'), at: Date.now() }
    return latest.build
  },

  async startUpdate({ actor, appVersion }: { actor: Caller; appVersion?: string | string[] }): Promise<Update> {
    latest.at = 0
    const to = await adminService.latestBuild()
    if (!to || !isNewer({ latest: to, current: config.build })) throw new HttpError(409, 'This is already the latest release.')
    const running = await currentUpdate(await probe())
    if (running?.status === 'running') throw new HttpError(409, 'An update is already running. This page shows when it finishes.')
    const stored = { from: config.build, to, startedAt: new Date().toISOString() }
    await settings.setUpdate(JSON.stringify(stored))
    await agentd.update({ appVersion: typeof appVersion === 'string' && SEMVER.test(appVersion) ? appVersion : undefined, sha256: latest.sha256 }).catch(async (err: unknown) => {
      await settings.setUpdate('')
      throw err
    })
    record({ action: 'admin.update_started', actor, target: { type: 'admin', id: 'install', from: stored.from, to } })
    return { object: 'update', status: 'running', ...stored }
  },

  async startSeatSignIn(): Promise<SeatSignIn> {
    if (config.modelMode !== 'claude') throw new HttpError(409, 'This server runs the test model, so it has no Claude seat.')
    return seatSignIn.start()
  },

  async completeSeatSignIn({ actor, id, code }: { actor: Caller; id: string; code: string }): Promise<SeatSignIn> {
    const token = await seatSignIn.complete({ id, code })
    await adminService.update({ actor, patch: { seatToken: token } })
    record({ action: 'admin.seat_signed_in', actor, target: { type: 'admin', id: 'install' } })
    return { id, object: 'seat_sign_in', status: 'complete', url: null }
  },

  async startCodexSignIn(): Promise<CodexSignIn> {
    const code = await codex.requestCode()
    const id = newId('csi')
    codexSignIns.set(id, { ...code, until: Date.now() + CODEX_SIGN_IN_MS })
    return { id, object: 'codex_sign_in', status: 'open', url: codex.signInUrl, userCode: code.userCode }
  },

  async checkCodexSignIn({ actor, id }: { actor: Caller; id: string }): Promise<CodexSignIn> {
    const open = codexSignIns.get(id)
    if (!open || open.until < Date.now()) throw new HttpError(404, 'That ChatGPT sign-in has ended. Start a new one.')
    const done = await codex.poll(open)
    if (done) {
      codexSignIns.delete(id)
      await providerService.refresh({ id: 'codex' })
      record({ action: 'admin.codex_signed_in', actor, target: { type: 'admin', id: 'install' } })
    }
    return { id, object: 'codex_sign_in', status: done ? 'complete' : 'open', url: codex.signInUrl, userCode: open.userCode }
  },

  async update({ actor, patch }: { actor: Caller; patch: UpdateAdmin }): Promise<Admin> {
    if (patch.tailnetUrl !== undefined) await setTailnetUrl(patch.tailnetUrl)
    if (patch.seatToken !== undefined) await settings.setSeatToken(patch.seatToken)
    if (patch.usageData !== undefined) await setUsage(patch.usageData)
    if (patch.googleClientId !== undefined || patch.googleClientSecret !== undefined) await setGoogleClient(patch)
    record({ action: 'admin.updated', actor, target: { type: 'admin', id: 'install', fields: Object.keys(patch) } })
    return adminService.status()
  },
}

async function transferOf({ actor, connectionId, subscription }: { actor: Caller; connectionId?: string; subscription?: 'claude' | 'codex' }): Promise<Transfer> {
  if (connectionId) {
    const row = await connectionService.owned({ actor, id: connectionId })
    if (row.sign_in) throw new HttpError(409, `${row.name} uses a sign-in, which can't be copied. Sign in to it again on the other computer.`, { param: 'connectionId' })
    return { type: 'connection', kind: row.kind, name: row.name, account: row.account, config: connectionService.unsealed(row.config) }
  }
  const token = settings.seatToken()
  const tokens = settings.codexTokens()
  if (subscription === 'claude' && token) return { type: 'claude', token, at: settings.seatAt() ?? new Date(0).toISOString() }
  if (subscription === 'codex' && tokens) return { type: 'codex', tokens, at: settings.codexAt() ?? new Date(0).toISOString() }
  throw new HttpError(409, subscription ? `This computer isn't signed in to ${subscription === 'claude' ? 'Claude' : 'ChatGPT'}, so there's nothing to copy.` : 'Send a connectionId or a subscription to export.', { param: subscription ? 'subscription' : 'connectionId' })
}

async function setUsage(on: boolean): Promise<void> {
  await settings.setUsageData(on)
  setUsageData(on)
}

export function isNewer({ latest, current }: { latest: string | null; current: string }): boolean {
  if (latest === null || latest === current || current === 'dev') return false
  if (!SEMVER.test(latest) || !SEMVER.test(current)) return true
  return latest.localeCompare(current, 'en', { numeric: true }) > 0
}

export function updateStatus({ stored, build, installing, last, now }: { stored: { from: string; to: string; startedAt: string }; build: string; installing: boolean; last?: LastUpdate | null; now: number }): { status: 'running' | 'failed' | 'done'; reason: string | null } {
  const age = now - Date.parse(stored.startedAt)
  const finished = last && Date.parse(last.at) >= Date.parse(stored.startedAt) ? last : null
  if (build === stored.to) return { status: 'done', reason: null }
  if (build !== stored.from) return { status: 'failed', reason: `It installed ${build} instead of ${stored.to}.` }
  if (age > UPDATE_LIMIT_MS) return { status: 'failed', reason: finished?.reason ?? 'It didn\'t finish within 45 minutes.' }
  if (finished) return { status: 'failed', reason: finished.reason ?? 'The new release didn\'t come up, so the previous one is running again.' }
  return installing || age < UPDATE_GRACE_MS ? { status: 'running', reason: null } : { status: 'failed', reason: 'The update stopped before it finished.' }
}

async function probe(): Promise<{ health: Health; installing: boolean; last: LastUpdate | null }> {
  const reply = await agentd.health().catch(() => undefined)
  const firewall = reply?.firewall ?? false
  return {
    health: { ok: !!reply && firewall, version: config.version, build: config.build, agentd: !!reply, firewall, started: config.started },
    installing: reply ? reply.updating ?? false : true,
    last: reply?.lastUpdate ?? null,
  }
}

async function currentUpdate({ installing, last }: { installing: boolean; last: LastUpdate | null }): Promise<Update | null> {
  const stored = z.safeParse(StoredUpdate, parseJson(settings.update()))
  if (!stored.success) return null
  const { status, reason } = updateStatus({ stored: stored.data, build: config.build, installing, last, now: Date.now() })
  if (status !== 'done') return { object: 'update', status, ...stored.data, reason }
  await settings.setUpdate('')
  return null
}

function attempt<T>(fn: () => T): T | undefined {
  try { return fn() } catch { return undefined }
}

function parseJson(text: string | undefined): unknown {
  try { return JSON.parse(text ?? '') } catch { return undefined }
}

async function setTailnetUrl(url: string | null): Promise<void> {
  const parsed = url === null ? undefined : new URL(url)
  if (parsed && (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username)) {
    throw new HttpError(400, 'Use just the address the app reaches this computer on, like https://beelink.example.ts.net, with no path.', { param: 'tailnetUrl' })
  }
  await settings.setTailnetUrl(parsed?.origin ?? null)
}

async function setGoogleClient({ googleClientId, googleClientSecret }: UpdateAdmin): Promise<void> {
  if (!googleClientId || !googleClientSecret) throw new HttpError(400, 'Paste both the client ID and the client secret.', { param: googleClientId ? 'googleClientSecret' : 'googleClientId' })
  await settings.setGoogleClient({ clientId: googleClientId.trim(), clientSecret: googleClientSecret.trim() })
}
