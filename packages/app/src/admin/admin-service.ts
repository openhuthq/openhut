import type { Admin, Health, UpdateAdmin } from '@jakebox/common/admin/admin.ts'
import { List } from '@jakebox/common/api.ts'
import { Release } from '@jakebox/common/console/console.ts'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { agentd, containerStates } from '../platform/agentd.ts'
import { publicUrl, settings } from '../platform/settings.ts'
import { log, record } from '../platform/events.ts'
import { agentService } from '../agents/agent-service.ts'
import { isAdmin, type Caller } from '../team/identity.ts'

const UPDATE_CHECK_EVERY_MS = 60 * 60_000
const CONSOLE_TIMEOUT_MS = 5_000
const UPDATE_COMMAND = 'curl -fsSL https://get.jakebox.dev | sh'
const RELEASE_BUILD = /^\d{14}$/
const Releases = List(Release)

let updateCheck: { at: number; update: Promise<Admin['update']> } | undefined

export const adminService = {
  boot(): void {
    if (!config.consoleUrl) return
    void availableUpdate()
    setInterval(availableUpdate, UPDATE_CHECK_EVERY_MS).unref()
  },

  async health(): Promise<Health> {
    const reply = await agentd.health().catch(() => undefined)
    const firewall = reply?.firewall ?? false
    return { ok: !!reply && firewall, version: config.version, build: config.build, agentd: !!reply, firewall, started: config.started }
  },

  async status(): Promise<Admin> {
    const [health, states, agents, update] = await Promise.all([adminService.health(), containerStates(), db.selectFrom('agent').select('id').execute(), availableUpdate()])
    return {
      object: 'admin',
      seat: { set: !!settings.seatToken(), mode: config.modelMode },
      server: {
        version: health.version, build: health.build, healthy: health.ok, agentd: health.agentd, firewall: health.firewall,
        running: agents.filter((agent) => states?.[agent.id] === 'running').length, total: agents.length,
      },
      publicUrl: publicUrl(),
      update,
    }
  },

  async update({ actor, patch }: { actor: Caller; patch: UpdateAdmin }): Promise<Admin> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can change Admin settings.')
    if (patch.publicUrl !== undefined) await setPublicUrl(patch.publicUrl)
    if (patch.seatToken !== undefined) await setSeat(patch.seatToken)
    record({ action: 'admin.updated', actor, target: { type: 'admin', id: 'install', fields: Object.keys(patch) } })
    return adminService.status()
  },
}

function availableUpdate(): Promise<Admin['update']> {
  if (!config.consoleUrl) return Promise.resolve(null)
  if (!updateCheck || Date.now() - updateCheck.at >= UPDATE_CHECK_EVERY_MS) updateCheck = { at: Date.now(), update: checkForUpdate() }
  return updateCheck.update
}

async function checkForUpdate(): Promise<Admin['update']> {
  const [latest] = await Promise.all([latestRelease().catch(skipped('update.check_failed')), checkIn().catch(skipped('update.check_in_failed'))])
  if (!latest || !isNewer({ build: latest.build, than: config.build })) return null
  return { latest: latest.version === config.version ? `${latest.version} (build ${latest.build})` : latest.version, command: UPDATE_COMMAND }
}

function isNewer({ build, than }: { build: string; than: string }): boolean {
  return RELEASE_BUILD.test(build) && RELEASE_BUILD.test(than) && build > than
}

async function latestRelease(): Promise<Release | undefined> {
  const res = await fetch(`${config.consoleUrl}/api/releases?limit=1`, { signal: AbortSignal.timeout(CONSOLE_TIMEOUT_MS) })
  if (!res.ok) throw new HttpError(502, `The release console answered ${res.status} for the latest release.`)
  const releases = Releases.safeParse(await res.json())
  if (!releases.success) throw new HttpError(502, 'The release console sent releases this server doesn\'t understand.')
  return releases.data.data[0]
}

async function checkIn(): Promise<void> {
  const res = await fetch(`${config.consoleUrl}/api/check-ins`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installId: await settings.installId(), build: config.build, version: config.version }),
    signal: AbortSignal.timeout(CONSOLE_TIMEOUT_MS),
  })
  if (!res.ok) throw new HttpError(502, `The release console answered ${res.status} to the check-in.`)
}

function skipped(event: string) {
  return (err: unknown) => {
    log.warn({ event, consoleUrl: config.consoleUrl, error: messageOf(err) })
    return undefined
  }
}

async function setSeat(token: string): Promise<void> {
  await settings.setSeatToken(token)
  const failed = await agentService.reapplyAll({ force: false })
  if (failed.length) log.warn({ event: 'seat.reapply_failed', error: failed.join('; ') })
}

async function setPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username) {
    throw new HttpError(400, 'Use just the address, like https://jakebox.example.com, with no path.', { param: 'publicUrl' })
  }
  await settings.setPublicUrl(parsed.origin)
}
