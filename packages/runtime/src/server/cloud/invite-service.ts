import { InviteLetter, type OpenedInvite, parseJson, type Cloud, type CloudInvite, type CloudInvitePreview, type CreateCloudInvite } from '@openhut/common/cloud/cloud.ts'
import { fromBase64, identity, type Identity } from '@openhut/common/vault/public.ts'
import { keyring } from '@openhut/common/keyring/keyring.ts'
import { cloud } from '../platform/cloud.ts'
import { HttpError } from '../platform/http-error.ts'
import { cloudService, mustBeOn, putList } from './cloud-service.ts'
import { keysService } from './keys-service.ts'
import { inviteId, roomKeys } from './room-keys.ts'
import { cloudEvents } from './cloud-events.ts'

const LINK = /#([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{43})\s*$/
const REFUSED: Record<number, string> = {
  404: 'This invite link no longer works. It was used already, or it was taken back. Ask for a new one.',
  410: 'This invite link expired. Invites last 48 hours. Ask for a new one.',
}

type Opened = { ws: string; card: Identity; invite: OpenedInvite; letter: InviteLetter }

export const inviteService = {
  async inviteToCloud({ workspace, email, role }: CreateCloudInvite): Promise<CloudInvite> {
    const made = await roomKeys.invite({ ws: mustBeOn(workspace), email, role, name: cloudEvents.name(workspace) })
    await putList({ workspace, list: made.list })
    const posted = await cloud.team(workspace).invite({ id: made.id, email, role, key: made.key, body: made.body })
    if (posted.status !== 200) throw new HttpError(502, `OpenHut Cloud didn’t keep the invite (HTTP ${posted.status}). Try again.`)
    await roomKeys.keepLink({ ws: workspace, email, link: made.link, until: made.expiresAt })
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
    const put = await cloud.team(ws).publish({ list, letters: [], boxes: [] })
    const status = put.status === 409 ? 404 : put.status
    if (status !== 200) throw new HttpError(REFUSED[status] ? status : 502, REFUSED[status] ?? `OpenHut Cloud didn’t let you join (HTTP ${status}). Try again.`)
    if (first) await roomKeys.addTeam({ ws, list, first })
    cloudService.connect()
    return cloudService.status()
  },
}

async function readInvite(link: string): Promise<Opened> {
  const parsed = LINK.exec(link)
  const ws = parsed?.[1]
  const secret = parsed?.[2]
  if (!ws || !secret) throw new HttpError(400, 'That isn’t an OpenHut invite link. Copy the whole link and try again.', { param: 'link' })
  if (!keysService.account() || !keysService.session()) throw new HttpError(409, 'Sign in to OpenHut Cloud to join.')
  if (roomKeys.room(ws)) throw new HttpError(409, 'You’re already in this team.', { param: 'link' })
  const id = await inviteId((await identity(fromBase64(secret))).publicKey)
  const invite = await fetchInvite({ ws, id })
  for (let page = invite; page.hasMore && page.memberLists.length;) {
    page = await fetchInvite({ ws, id, after: invite.memberLists.length })
    invite.memberLists.push(...page.memberLists)
  }
  const opened = await keyring.readInvite({ team: ws, secret, from: invite.from, body: invite.body })
  if (!opened || opened.letter.email !== invite.email || opened.letter.workspace !== ws) throw new HttpError(400, 'This invite doesn’t check out. Ask for a new link.')
  return { ws, invite, ...opened }
}

async function fetchInvite({ ws, id, after = 0 }: { ws: string; id: string; after?: number }): Promise<OpenedInvite> {
  const opened = await cloud.team(ws).openInvite({ id, after })
  if ('object' in opened) return opened
  const reply = opened
  const message = reply.status === 403 ? messageIn(reply.json) : REFUSED[reply.status]
  if (message) throw new HttpError(reply.status, message, { param: /This invite is for (\S+?)\. /.exec(message)?.[1] })
  throw new HttpError(502, `OpenHut Cloud didn’t send the invite (HTTP ${reply.status}). Try again.`)
}

function messageIn(json: unknown): string {
  const message = typeof json === 'object' && json && 'error' in json && typeof json.error === 'object' && json.error && 'message' in json.error ? json.error.message : undefined
  return typeof message === 'string' ? message : 'This invite is for another email.'
}
