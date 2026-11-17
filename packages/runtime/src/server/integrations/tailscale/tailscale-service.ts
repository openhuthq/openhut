import type { Tailscale } from '@openhut/common/connections/connection.ts'
import { agentd } from '../../platform/agentd.ts'
import { record } from '../../platform/events.ts'
import { HttpError } from '../../platform/http-error.ts'
import { settings } from '../../platform/settings.ts'
import type { Caller } from '../../team/identity.ts'

export const tailscaleService = {
  async get(): Promise<Tailscale> {
    const join = settings.tailscale()
    if (!join) return { object: 'tailscale', connected: null }
    const tailnet = await agentd.tailnet().catch(() => ({ state: 'Unknown', tailnet: '', name: '', address: '' }))
    return { object: 'tailscale', connected: { ...join, ...tailnet } }
  },

  async connect({ actor, authKey }: { actor: Caller; authKey: string }): Promise<Tailscale> {
    const joined = await agentd.joinTailnet({ authKey })
    if (joined.state !== 'Running') throw new HttpError(502, `Tailscale is ${joined.state}, not running. Check the auth key hasn't expired or been used, then try again.`, { param: 'authKey' })
    await settings.setTailscale({ by: actor.email, at: new Date().toISOString(), joined: joined.joined })
    record({ action: 'tailscale.connected', actor, target: { type: 'tailscale', id: joined.name, tailnet: joined.tailnet } })
    return tailscaleService.get()
  },

  async disconnect({ actor }: { actor: Caller }): Promise<Tailscale> {
    const join = settings.tailscale()
    if (join?.joined) await agentd.leaveTailnet()
    await settings.setTailscale(undefined)
    record({ action: 'tailscale.disconnected', actor, target: { type: 'tailscale', id: 'tailscale', left: !!join?.joined } })
    return tailscaleService.get()
  },
}
