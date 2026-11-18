import { randomBytes } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { sixDigits, verifyProof, type Decision, type Hello, type Invited } from '@openhut/tunnel'
import type { Invitation } from '@openhut/common/access/invitation.ts'
import { config } from '../platform/config.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { computerId, newId, relayKeyHex } from '../platform/secrets.ts'
import type { Caller } from '../team/identity.ts'
import { accessService } from './access-service.ts'

const LIFETIME_MS = 5 * 60_000
const POLL_MS = 250
const invitations = new Map<string, Open>()

type Open = { id: string; secret: string; expiresAt: number; status: 'waiting' | 'joined' | 'accepted' | 'declined'; device: Invitation['device']; digits: string | null }

export const invitationService = {
  create({ actor }: { actor: Caller }): Invitation {
    if (!config.relayUrl) throw new HttpError(409, 'This computer isn\'t on the relay, so nothing can join it. Set OPENHUT_RELAY_URL and restart it.')
    const { owner } = accessService.get()
    const open: Open = { id: newId('inv'), secret: randomBytes(32).toString('hex'), expiresAt: Date.now() + LIFETIME_MS, status: 'waiting', device: null, digits: null }
    invitations.set(open.id, open)
    const code = new URL('openhut://join')
    for (const [name, value] of [['c', computerId], ['k', relayKeyHex], ['o', owner], ['s', open.secret], ['r', config.relayUrl]]) code.searchParams.set(name, value)
    emit({ name: 'invitation.created', actor, target: { type: 'invitation', id: open.id } })
    return { ...shown(open), code: code.href }
  },

  get(id: string): Invitation {
    return shown(found(id))
  },

  decline({ actor, id }: { actor: Caller; id: string }): Invitation {
    const open = found(id)
    if (status(open) === 'accepted') throw new HttpError(409, 'This device already joined. Remove it in Settings › Devices instead.')
    open.status = 'declined'
    emit({ name: 'invitation.declined', actor, target: { type: 'invitation', id } })
    return shown(open)
  },

  async invited({ key, proof, handshakeHash, hello }: { key: string; proof: string; handshakeHash: Uint8Array; hello: Hello }): Promise<Invited | null> {
    for (const open of invitations.values()) {
      if (status(open) !== 'waiting' || !await verifyProof({ secret: open.secret, handshakeHash, proof })) continue
      if (open.status !== 'waiting') return null
      Object.assign(open, { status: 'joined', device: { name: hello.name, kind: hello.kind, key }, digits: await sixDigits(handshakeHash) })
      return { accept: () => decided({ open, key }) }
    }
    return null
  },
}

async function* decided({ open, key }: { open: Open; key: string }): AsyncGenerator<Decision> {
  for (;;) {
    const access = accessService.holding(key)
    if (access && open.status === 'joined') open.status = 'accepted'
    if (access && open.status === 'accepted') return yield { type: 'accepted', access }
    if (status(open) !== 'joined') return yield { type: 'declined' }
    await sleep(POLL_MS)
  }
}

function status(open: Open): Invitation['status'] {
  if ((open.status === 'waiting' || open.status === 'joined') && Date.now() > open.expiresAt) return 'expired'
  return open.status
}

function found(id: string): Open {
  const open = invitations.get(id)
  if (!open) throw new HttpError(404, 'There\'s no such invitation on this computer. Invitations last 5 minutes and are gone after a restart.')
  return open
}

function shown(open: Open): Invitation {
  return { object: 'invitation', id: open.id, status: status(open), expiresAt: new Date(open.expiresAt).toISOString(), device: open.device, digits: open.digits }
}
