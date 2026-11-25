import * as z from 'zod/mini'
import { MIN_APP_VERSION, type Admin, type CodexSignIn, type Health, type SeatSignIn, type SeatUsage, type Update, type UpdateAdmin } from '@openhut/common/admin/admin.ts'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError } from '../platform/http-error.ts'
import { createHash } from 'node:crypto'
import { agentd, containerStates, features } from '../platform/agentd.ts'
import { installing as installRunning, lastUpdate, request, type LastUpdate } from './update-request.ts'
import { settings } from '../platform/settings.ts'
import { emit } from '../platform/events.ts'
import { newId, transferPublicKey } from '../platform/secrets.ts'
import { codex } from '../integrations/codex/codex.ts'
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
      seat: { set: !!settings.seatToken(), mode: config.modelMode, updatedAt: settings.seatAt(), download: null },
      codex: { set: !!settings.codexTokens(), updatedAt: settings.codexAt() },
      server: {
        version: health.version, build: health.build, latestBuild, updateAvailable: isNewer({ latest: latestBuild, current: health.build }), update: await currentUpdate({ installing, last }), healthy: health.ok, agentd: health.agentd, firewall: health.firewall,
        running: agents.filter((agent) => states?.[agent.id] === 'running').length, total: agents.length,
      },
      publicKey: transferPublicKey,
      features: available,
      minAppVersion: MIN_APP_VERSION,
    }
  },

  async seatUsage(): Promise<SeatUsage> {
    if (!settings.seatToken()) throw new HttpError(409, 'Sign in to Claude under Settings › Models to see usage.')
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
    return (await latestRelease({ fresh: false })).build
  },

  async startUpdate({ actor, appVersion }: { actor: Caller; appVersion?: string }): Promise<Update> {
    const { build: to, sha256 } = await latestRelease({ fresh: true })
    if (!to) throw new HttpError(502, 'Couldn\'t check for a new version. Try again in a minute.')
    if (!isNewer({ latest: to, current: config.build })) throw new HttpError(409, 'This computer is already up to date.')
    const running = await currentUpdate(await probe())
    if (running?.status === 'running') throw new HttpError(409, 'An update is already running. This page shows when it finishes.')
    const stored = { from: config.build, to, startedAt: new Date().toISOString() }
    await settings.setUpdate(JSON.stringify(stored))
    await request({ appVersion: appVersion && SEMVER.test(appVersion) ? appVersion : undefined, sha256 }).catch(async (err: unknown) => {
      await settings.setUpdate('')
      throw err
    })
    emit({ name: 'admin.update_started', actor, target: { type: 'admin', id: 'install', from: stored.from, to } })
    return { object: 'update', status: 'running', ...stored }
  },

  async startSeatSignIn(): Promise<SeatSignIn> {
    if (config.modelMode !== 'claude') throw new HttpError(409, 'This computer uses the test model, so there\'s no Claude sign-in.')
    return seatSignIn.start()
  },

  async completeSeatSignIn({ actor, id, code }: { actor: Caller; id: string; code: string }): Promise<SeatSignIn> {
    const token = await seatSignIn.complete({ id, code })
    await adminService.update({ actor, patch: { seatToken: token } })
    emit({ name: 'admin.seat_signed_in', actor, target: { type: 'admin', id: 'install' } })
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
      await providerService.signedIn({ id: 'codex', secret: done })
      await providerService.refresh({ id: 'codex' })
      emit({ name: 'admin.codex_signed_in', actor, target: { type: 'admin', id: 'install' } })
    }
    return { id, object: 'codex_sign_in', status: done ? 'complete' : 'open', url: codex.signInUrl, userCode: open.userCode }
  },

  async update({ actor, patch }: { actor: Caller; patch: UpdateAdmin }): Promise<Admin> {
    if (patch.seatToken !== undefined) await providerService.signedIn({ id: 'claude', secret: { token: patch.seatToken, at: new Date().toISOString() } })
    emit({ name: 'admin.updated', actor, target: { type: 'admin', id: 'install', fields: Object.keys(patch) } })
    return adminService.status()
  },
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

async function latestRelease({ fresh }: { fresh: boolean }): Promise<{ build: string | null; sha256: string }> {
  if (config.installKind !== 'server') return { build: null, sha256: '' }
  if (!fresh && Date.now() - latest.at < LATEST_TTL_MS) return latest
  const script = await fetch(config.releaseUrl, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) })
    .then((response) => response.ok ? response.text() : '').catch(() => '')
  const found = { build: BUILD_LINE.exec(script)?.[1] ?? null, sha256: createHash('sha256').update(script).digest('hex'), at: Date.now() }
  if (found.build || !latest.build) latest = found
  return found
}

async function probe(): Promise<{ health: Health; installing: boolean; last: LastUpdate | null }> {
  const reply = await agentd.health().catch(() => undefined)
  const firewall = reply?.firewall ?? false
  return {
    health: { ok: true, version: config.version, build: config.build, agentd: !!reply, firewall, started: config.started },
    installing: await installRunning(),
    last: lastUpdate(),
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

function parseJson(text: string | undefined): unknown {
  try { return JSON.parse(text ?? '') } catch { return undefined }
}

