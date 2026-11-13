import type { Admin, Health, UpdateAdmin } from '@jakebox/common/admin/admin.ts'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError } from '../platform/http-error.ts'
import { agentd, containerStates } from '../platform/agentd.ts'
import { settings } from '../platform/settings.ts'
import { agentService } from '../agents/agent-service.ts'
import { isAdmin, type Caller } from '../team/identity.ts'

export const adminService = {
  async health(): Promise<Health> {
    const reply = await agentd({ cmd: 'health' }).catch(() => undefined)
    const firewall = reply?.firewall ?? false
    return { ok: !!reply && firewall, version: config.version, build: config.build, agentd: !!reply, firewall, started: config.started }
  },

  async status({ url }: { url: string }): Promise<Admin> {
    const [health, states, agents] = await Promise.all([adminService.health(), containerStates(), db.selectFrom('agent').select('id').execute()])
    return {
      object: 'admin',
      seat: { set: !!settings.seatToken(), mode: config.modelMode },
      server: {
        version: health.version, build: health.build, healthy: health.ok, agentd: health.agentd, firewall: health.firewall,
        running: agents.filter((agent) => states?.[agent.id] === 'running').length, total: agents.length,
      },
      publicUrl: url,
    }
  },

  async update({ actor, patch }: { actor: Caller; patch: UpdateAdmin }): Promise<void> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can change Admin settings.')
    if (patch.publicUrl !== undefined) await setPublicUrl(patch.publicUrl)
    if (patch.seatToken !== undefined) await setSeat(patch.seatToken)
  },
}

async function setSeat(token: string): Promise<void> {
  await settings.setSeatToken(token)
  const failed = await agentService.reapplyAll({ force: false })
  if (failed.length) throw new HttpError(502, `The seat is saved, but these agents didn't take it yet; they will at their next start: ${failed.join('; ')}`)
}

async function setPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username) {
    throw new HttpError(400, 'Use just the address, like https://jakebox.example.com, with no path.', { param: 'publicUrl' })
  }
  await settings.setPublicUrl(parsed.origin)
}
