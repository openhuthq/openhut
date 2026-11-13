import type { Admin, Health, Update, UpdateAdmin } from '@fastmonkey/common/admin/admin.ts'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError } from '../platform/http-error.ts'
import { agentd, containerStates } from '../platform/agentd.ts'
import { publicUrl, settings } from '../platform/settings.ts'
import { log, record } from '../platform/events.ts'
import { agentService } from '../agents/agent-service.ts'
import { isAdmin, type Caller } from '../team/identity.ts'

const LATEST_TTL_MS = 60_000
const LATEST_TIMEOUT_MS = 4_000
const BUILD_LINE = /^FASTMONKEY_BUILD="([\w.-]+)"$/m
let latest: { build: string | null; at: number } = { build: null, at: 0 }

export const adminService = {
  async health(): Promise<Health> {
    const reply = await agentd.health().catch(() => undefined)
    const firewall = reply?.firewall ?? false
    return { ok: !!reply && firewall, version: config.version, build: config.build, agentd: !!reply, firewall, started: config.started }
  },

  async status(): Promise<Admin> {
    const [health, states, agents, latestBuild] = await Promise.all([adminService.health(), containerStates(), db.selectFrom('agent').select('id').execute(), adminService.latestBuild()])
    return {
      object: 'admin',
      seat: { set: !!settings.seatToken(), mode: config.modelMode },
      server: {
        version: health.version, build: health.build, latestBuild, updateAvailable: isNewer({ latest: latestBuild, current: health.build }), healthy: health.ok, agentd: health.agentd, firewall: health.firewall,
        running: agents.filter((agent) => states?.[agent.id] === 'running').length, total: agents.length,
      },
      publicUrl: publicUrl(),
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
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can update Fast Monkey.')
    latest.at = 0
    const to = await adminService.latestBuild()
    if (!to || !isNewer({ latest: to, current: config.build })) throw new HttpError(409, 'Fast Monkey is already on the latest release.')
    await agentd.update()
    record({ action: 'admin.update_started', actor, target: { type: 'admin', id: 'install', from: config.build, to } })
    return { object: 'update', from: config.build, to }
  },

  async update({ actor, patch }: { actor: Caller; patch: UpdateAdmin }): Promise<Admin> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can change Admin settings.')
    if (patch.publicUrl !== undefined) await setPublicUrl(patch.publicUrl)
    if (patch.seatToken !== undefined) await setSeat(patch.seatToken)
    record({ action: 'admin.updated', actor, target: { type: 'admin', id: 'install', fields: Object.keys(patch) } })
    return adminService.status()
  },
}

export function isNewer({ latest, current }: { latest: string | null; current: string }): boolean {
  return latest !== null && /^\d+$/.test(latest) && /^\d+$/.test(current) && latest > current
}

async function setSeat(token: string): Promise<void> {
  await settings.setSeatToken(token)
  const failed = await agentService.reapplyAll({ force: false })
  if (failed.length) log.warn({ event: 'seat.reapply_failed', error: failed.join('; ') })
}

async function setPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username) {
    throw new HttpError(400, 'Use just the address, like https://fastmonkey.example.com, with no path.', { param: 'publicUrl' })
  }
  await settings.setPublicUrl(parsed.origin)
}
