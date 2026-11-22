import { randomBytes } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { sixDigits, verifyProof, type Decision, type Hello, type Invited } from '@openhut/tunnel'
import type { Invitation } from '@openhut/common/access/invitation.ts'
import { InviteLetter, OpenedInvite, parseJson, type Cloud, type CloudInvite, type CloudInvitePreview, type CreateCloudInvite } from '@openhut/common/cloud/cloud.ts'
import { fromBase64, identity, openInvite, read, type Identity } from '@openhut/common/vault/vault.ts'
import { cloudService, mustBeOn, putList } from '../cloud/cloud-service.ts'
import { keysService } from '../cloud/keys-service.ts'
import { inviteId, roomKeys } from '../cloud/room-keys.ts'
import { syncService } from '../cloud/sync-service.ts'
import { cloud } from '../platform/cloud.ts'
import { config } from '../platform/config.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { computerId, newId, relayKeyHex } from '../platform/secrets.ts'
import type { Caller } from '../team/identity.ts'
import { accessService } from './access-service.ts'

const LIFETIME_MS = 5 * 60_000
const RELAY_GRACE_MS = 60_000
const POLL_MS = 250
const invitations = new Map<string, Open>()
const LINK = /#([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{43})\s*$/
const REFUSED: Record<number, string> = {
  404: 'This invite link no longer works. It was used already, or it was taken back. Ask for a new one.',
  410: 'This invite link expired. Invites last 48 hours. Ask for a new one.',
}

type Opened = { ws: string; card: Identity; invite: OpenedInvite; letter: InviteLetter }

type Open = { id: string; secret: string; expiresAt: number; status: 'waiting' | 'joined' | 'accepted' | 'declined'; device: Invitation['device']; digits: string | null }

export const invitationService = {
  create({ actor }: { actor: Caller }): Invitation {
    if (!config.relayUrl) throw new HttpError(409, 'This copy of OpenHut can\'t add phones or computers. Download OpenHut again from openhut.dev.')
    const { owner } = accessService.get()
    const open: Open = { id: newId('inv'), secret: randomBytes(32).toString('hex'), expiresAt: Date.now() + LIFETIME_MS, status: 'waiting', device: null, digits: null }
    invitations.set(open.id, open)
    const code = new URL('openhut://join')
    for (const [name, value] of [['c', computerId], ['k', relayKeyHex], ['o', owner], ['s', open.secret], ['r', config.relayUrl]]) code.searchParams.set(name, value)
    emit({ name: 'invitation.created', actor, target: { type: 'invitation', id: open.id } })
    return { ...shown(open), code: code.href }
  },

  waiting(): boolean {
    return [...invitations.values()].some((open) => Date.now() < open.expiresAt + RELAY_GRACE_MS)
  },

  get(id: string): Invitation {
    return shown(found(id))
  },

  decline({ actor, id }: { actor: Caller; id: string }): Invitation {
    const open = found(id)
    if (status(open) === 'accepted') throw new HttpError(409, 'This device already joined. Remove it in Settings › Phones instead.')
    open.status = 'declined'
    emit({ name: 'invitation.declined', actor, target: { type: 'invitation', id } })
    return shown(open)
  },

  async inviteToCloud({ workspace, email, role }: CreateCloudInvite): Promise<CloudInvite> {
    const made = await roomKeys.invite({ ws: mustBeOn(workspace), email, role, name: syncService.name(workspace) })
    await putList({ workspace, list: made.list })
    const posted = await cloud.room({ method: 'POST', workspace, path: '/invites', token: await keysService.token(), body: { id: made.id, email, role, key: made.key, body: made.body } })
    if (posted.status !== 200) throw new HttpError(502, `OpenHut Cloud didn’t keep the invite (HTTP ${posted.status}). Try again.`)
    await roomKeys.keepLink({ ws: workspace, email, link: made.link })
    return { object: 'cloud_invite', id: made.id, workspace, email, role, link: made.link, expiresAt: made.expiresAt }
  },

  async previewCloudInvite({ link }: { link: string }): Promise<CloudInvitePreview> {
    const { ws, letter } = await readInvite(link)
    return { object: 'cloud_invite_preview', workspace: ws, name: letter.name, from: letter.from, email: letter.email, role: letter.role }
  },

  async joinCloud({ link }: { link: string }): Promise<Cloud> {
    const { ws, card, invite, letter } = await readInvite(link)
    const list = await roomKeys.joinList({ card, chain: invite.memberLists, anchor: letter.anchor, ws })
    const first = invite.memberLists[0]
    const put = await cloud.room({ method: 'PUT', workspace: ws, path: '/members', token: await keysService.token(), body: list })
    const status = put.status === 409 ? 404 : put.status
    if (status !== 200) throw new HttpError(REFUSED[status] ? status : 502, REFUSED[status] ?? `OpenHut Cloud didn’t let you join (HTTP ${status}). Try again.`)
    if (first) await roomKeys.addTeam({ ws, list, first })
    cloudService.connect()
    return cloudService.status()
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

async function readInvite(link: string): Promise<Opened> {
  const parsed = LINK.exec(link)
  const ws = parsed?.[1]
  const secret = parsed?.[2]
  if (!ws || !secret) throw new HttpError(400, 'That isn’t an OpenHut invite link. Copy the whole link and try again.', { param: 'link' })
  if (!keysService.account() || !keysService.session()) throw new HttpError(409, 'Sign in to OpenHut Cloud to join.')
  if (roomKeys.room(ws)) throw new HttpError(409, 'You’re already in this team.', { param: 'link' })
  const card = await identity(fromBase64(secret))
  const id = await inviteId(card.publicKey)
  const invite = await fetchInvite({ ws, id })
  for (let page = invite; page.hasMore && page.memberLists.length;) {
    page = await fetchInvite({ ws, id, after: invite.memberLists.length })
    invite.memberLists.push(...page.memberLists)
  }
  const sealed = await read({ recipient: card, from: fromBase64(invite.from), workspace: ws, purpose: 'invite', body: fromBase64(invite.body), allowed: [fromBase64(invite.from)] })
  const plain = sealed && await openInvite({ secret: card.secret, workspace: ws, locked: sealed })
  const letter = plain && InviteLetter.safeParse(parseJson(new TextDecoder().decode(plain))).data
  if (!letter || letter.email !== invite.email || letter.workspace !== ws) throw new HttpError(400, 'This invite doesn’t check out. Ask for a new link.')
  return { ws, card, invite, letter }
}

async function fetchInvite({ ws, id, after = 0 }: { ws: string; id: string; after?: number }): Promise<OpenedInvite> {
  const reply = await cloud.room({ method: 'GET', workspace: ws, path: `/invites/${id}?after=${after}`, token: await keysService.token() })
  const message = reply.status === 403 ? messageIn(reply.json) : REFUSED[reply.status]
  if (message) throw new HttpError(reply.status, message, { param: /This invite is for (\S+?)\. /.exec(message)?.[1] })
  const invite = OpenedInvite.safeParse(reply.json).data
  if (reply.status !== 200 || !invite) throw new HttpError(502, `OpenHut Cloud didn’t send the invite (HTTP ${reply.status}). Try again.`)
  return invite
}

function messageIn(json: unknown): string {
  const message = typeof json === 'object' && json && 'error' in json && typeof json.error === 'object' && json.error && 'message' in json.error ? json.error.message : undefined
  return typeof message === 'string' ? message : 'This invite is for another email.'
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
  if (!open) throw new HttpError(404, 'This code no longer works. Make a new code.')
  return open
}

function shown(open: Open): Invitation {
  return { object: 'invitation', id: open.id, status: status(open), expiresAt: new Date(open.expiresAt).toISOString(), device: open.device, digits: open.digits }
}
