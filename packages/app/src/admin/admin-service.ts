import * as z from 'zod/mini'
import type { Admin, AgentContainer, Health, SeatSignIn, SeatUsage, Update, UpdateAdmin } from '@openhut/common/admin/admin.ts'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError } from '../platform/http-error.ts'
import { agentd, containerStates } from '../platform/agentd.ts'
import { publicUrl, settings } from '../platform/settings.ts'
import { log, record } from '../platform/events.ts'
import { agentService } from '../agents/agent-service.ts'
import { isAdmin, type Caller } from '../team/identity.ts'
import { seatSignIn } from './seat-sign-in.ts'
import { seatLimits } from './seat-limits.ts'

const LATEST_TTL_MS = 60_000
const LATEST_TIMEOUT_MS = 4_000
const BUILD_LINE = /^OPENHUT_BUILD="([\w.-]+)"$/m
const SEMVER = /^\d+\.\d+\.\d+$/
const UPDATE_GRACE_MS = 20_000
const UPDATE_LIMIT_MS = 45 * 60_000
const WEEK_MS = 7 * 24 * 60 * 60_000
const StoredUpdate = z.object({ from: z.string(), to: z.string(), startedAt: z.string() })
let latest: { build: string | null; at: number } = { build: null, at: 0 }

export const adminService = {
  async health(): Promise<Health> {
    return (await probe()).health
  },

  async containers({ actor }: { actor: Caller }): Promise<AgentContainer[]> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can see the containers.')
    const [{ containers }, agents] = await Promise.all([agentd.containers(), db.selectFrom('agent').select(['id', 'name', 'wanted']).orderBy('created_at').execute()])
    const known = new Set(containers.map((container) => container.agentId))
    const byId = new Map(agents.map((agent) => [agent.id, agent]))
    return [
      ...containers.map((container) => ({
        object: 'container' as const, agentId: container.agentId, agentName: byId.get(container.agentId)?.name ?? null, wanted: byId.get(container.agentId)?.wanted ?? null,
        name: container.name, state: container.state, status: container.status, image: container.image, createdAt: container.createdAt, network: container.networks,
      })),
      ...agents.filter((agent) => !known.has(agent.id)).map((agent) => ({
        object: 'container' as const, agentId: agent.id, agentName: agent.name, wanted: agent.wanted, name: null, state: 'none', status: 'No container', image: '', createdAt: '', network: '',
      })),
    ]
  },

  async status(): Promise<Admin> {
    const [{ health, installing }, states, agents, latestBuild] = await Promise.all([probe(), containerStates(), db.selectFrom('agent').select('id').execute(), adminService.latestBuild()])
    return {
      object: 'admin',
      seat: { set: !!settings.seatToken(), mode: config.modelMode },
      server: {
        version: health.version, build: health.build, latestBuild, updateAvailable: isNewer({ latest: latestBuild, current: health.build }), update: await currentUpdate({ installing }), healthy: health.ok, agentd: health.agentd, firewall: health.firewall,
        running: agents.filter((agent) => states?.[agent.id] === 'running').length, total: agents.length,
      },
      publicUrl: publicUrl(),
      google: { clientId: settings.googleClient()?.clientId ?? null, redirectUri: `${publicUrl()}/api/connection-authorizations/callback` },
    }
  },

  async seatUsage(): Promise<SeatUsage> {
    const token = settings.seatToken()
    if (config.modelMode !== 'claude' || !token) throw new HttpError(409, 'No Claude seat is connected, so there\'s no usage to show.')
    const windows = await seatLimits.read(token)
    const resetsAt = windows.find((window) => window.kind === 'seven_day')?.resetsAt
    const since = (resetsAt ? Date.parse(resetsAt) : Date.now()) - WEEK_MS
    const [{ usage }, agents] = await Promise.all([agentd.usage({ since: since / 1000 }), db.selectFrom('agent').select(['id', 'name']).orderBy('created_at').execute()])
    return {
      object: 'seat_usage', windows, since: new Date(since).toISOString(),
      agents: agents.map((agent) => ({ agentId: agent.id, agentName: agent.name, costUsd: usage[agent.id] ?? 0 })).sort((a, b) => b.costUsd - a.costUsd),
    }
  },

  async latestBuild(): Promise<string | null> {
    if (Date.now() - latest.at < LATEST_TTL_MS) return latest.build
    const script = await fetch(config.releaseUrl, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) })
      .then((response) => response.ok ? response.text() : '').catch(() => '')
    latest = { build: BUILD_LINE.exec(script)?.[1] ?? null, at: Date.now() }
    return latest.build
  },

  async startUpdate({ actor }: { actor: Caller }): Promise<Update> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can update the app.')
    latest.at = 0
    const to = await adminService.latestBuild()
    if (!to || !isNewer({ latest: to, current: config.build })) throw new HttpError(409, 'This is already the latest release.')
    const running = await currentUpdate({ installing: (await probe()).installing })
    if (running?.status === 'running') throw new HttpError(409, 'An update is already running. This page shows when it finishes.')
    const stored = { from: config.build, to, startedAt: new Date().toISOString() }
    await settings.setUpdate(JSON.stringify(stored))
    await agentd.update().catch(async (err: unknown) => {
      await settings.setUpdate('')
      throw err
    })
    record({ action: 'admin.update_started', actor, target: { type: 'admin', id: 'install', from: stored.from, to } })
    return { object: 'update', status: 'running', ...stored }
  },

  async startSeatSignIn({ actor }: { actor: Caller }): Promise<SeatSignIn> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can connect the Claude seat.')
    if (config.modelMode !== 'claude') throw new HttpError(409, 'This server runs the test model, so it has no Claude seat.')
    return seatSignIn.start()
  },

  async completeSeatSignIn({ actor, id, code }: { actor: Caller; id: string; code: string }): Promise<SeatSignIn> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can connect the Claude seat.')
    const token = await seatSignIn.complete({ id, code })
    await adminService.update({ actor, patch: { seatToken: token } })
    record({ action: 'admin.seat_signed_in', actor, target: { type: 'admin', id: 'install' } })
    return { id, object: 'seat_sign_in', status: 'complete', url: null }
  },

  async update({ actor, patch }: { actor: Caller; patch: UpdateAdmin }): Promise<Admin> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can change Admin settings.')
    if (patch.publicUrl !== undefined) await setPublicUrl(patch.publicUrl)
    if (patch.seatToken !== undefined) await setSeat(patch.seatToken)
    if (patch.googleClientId !== undefined || patch.googleClientSecret !== undefined) await setGoogleClient(patch)
    record({ action: 'admin.updated', actor, target: { type: 'admin', id: 'install', fields: Object.keys(patch) } })
    return adminService.status()
  },
}

export function isNewer({ latest, current }: { latest: string | null; current: string }): boolean {
  if (latest === null || latest === current || current === 'dev') return false
  if (!SEMVER.test(latest) || !SEMVER.test(current)) return true
  return latest.localeCompare(current, 'en', { numeric: true }) > 0
}

export function updateStatus({ stored, build, installing, now }: { stored: { from: string; startedAt: string }; build: string; installing: boolean; now: number }): 'running' | 'failed' | 'done' {
  const age = now - Date.parse(stored.startedAt)
  if (build !== stored.from) return 'done'
  if (age > UPDATE_LIMIT_MS) return 'failed'
  return installing || age < UPDATE_GRACE_MS ? 'running' : 'failed'
}

async function probe(): Promise<{ health: Health; installing: boolean }> {
  const reply = await agentd.health().catch(() => undefined)
  const firewall = reply?.firewall ?? false
  return {
    health: { ok: !!reply && firewall, version: config.version, build: config.build, agentd: !!reply, firewall, started: config.started },
    installing: reply ? reply.updating ?? false : true,
  }
}

async function currentUpdate({ installing }: { installing: boolean }): Promise<Update | null> {
  const stored = z.safeParse(StoredUpdate, parseJson(settings.update()))
  if (!stored.success) return null
  const status = updateStatus({ stored: stored.data, build: config.build, installing, now: Date.now() })
  if (status !== 'done') return { object: 'update', status, ...stored.data }
  await settings.setUpdate('')
  return null
}

function parseJson(text: string | undefined): unknown {
  try { return JSON.parse(text ?? '') } catch { return undefined }
}

async function setSeat(token: string): Promise<void> {
  await settings.setSeatToken(token)
  const failed = await agentService.reapplyAll({ force: false })
  if (failed.length) log.warn({ event: 'seat.reapply_failed', error: failed.join('; ') })
}

async function setGoogleClient({ googleClientId, googleClientSecret }: UpdateAdmin): Promise<void> {
  if (!googleClientId || !googleClientSecret) throw new HttpError(400, 'Paste both the client ID and the client secret.', { param: googleClientId ? 'googleClientSecret' : 'googleClientId' })
  await settings.setGoogleClient({ clientId: googleClientId.trim(), clientSecret: googleClientSecret.trim() })
}

async function setPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username) {
    throw new HttpError(400, 'Use just the address, like https://openhut.example.com, with no path.', { param: 'publicUrl' })
  }
  await settings.setPublicUrl(parsed.origin)
}
