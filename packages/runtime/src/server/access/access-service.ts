import * as z from 'zod/mini'
import { Access, verify } from '@openhut/common/access/access.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { settings } from '../platform/settings.ts'

export type Device = 'client' | 'removed' | 'unknown'

export const accessService = {
  get(): Access {
    const access = current()
    if (!access) throw new HttpError(404, 'This computer has no access list yet. The OpenHut app on your Mac signs one and sends it here.')
    return access
  },

  async put({ access, local }: { access: Access; local: boolean }): Promise<Access> {
    if (!await verify(access)) throw new HttpError(400, 'The signature doesn\'t match this access list and its owner, so it wasn\'t saved.', { param: 'signature' })
    const now = current()
    if (now && now.owner !== access.owner && !local) throw new HttpError(403, 'This computer belongs to another owner. Only a request on its own socket can give it a new one.', { param: 'owner' })
    if (now && now.owner === access.owner && access.version <= now.version) throw new HttpError(409, `This computer already has version ${now.version} of the access list. Send a newer one.`, { param: 'version' })
    const kept = new Set(access.clients.map((client) => client.key))
    const removed = [...new Set([...settings.removedClients(), ...(now?.clients ?? []).map((client) => client.key)])].filter((key) => !kept.has(key))
    await settings.setAccess({ access: JSON.stringify(access), removed })
    emit({ name: 'access.updated', target: { type: 'access', id: access.owner, version: access.version } })
    return access
  },

  holding(key: string): Access | undefined {
    const access = current()
    return access?.clients.some((client) => client.key === key) || access?.computers.some((computer) => computer.key === key) ? access : undefined
  },

  device(key: string): Device {
    if (current()?.clients.some((client) => client.key === key)) return 'client'
    return settings.removedClients().includes(key) ? 'removed' : 'unknown'
  },
}

function current(): Access | undefined {
  const stored = settings.access()
  return stored ? z.parse(Access, JSON.parse(stored)) : undefined
}
