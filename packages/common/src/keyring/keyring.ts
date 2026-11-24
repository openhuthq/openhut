import { InviteLetter, parseJson, type Letter, type MemberList, type MemberListBody } from '../cloud/cloud.ts'
import { check } from '../cloud/member-list.ts'
import type { Sealer } from '../cloud/records.ts'
import { HttpError } from '../http-error.ts'
import { signer, type Keyring as Ring, type Opened, type Value, type Where } from '../records/row.ts'
import { open, seal } from '../records/seal.ts'
import type { SealedRow } from '../records/wire.ts'
import { boxKey, fromBase64, identity, toBase64, type Bytes, type Identity } from '../vault/public.ts'
import { lock, openInvite, read, unlock } from '../vault/secret.ts'
import { accountDevice, keysService as keys, openLetter, sealTo, type Boxed, type Sent } from './keys.ts'
import { inviteId, roomKeys as rooms } from './rooms.ts'
import type { Account } from './store.ts'

export { Stored, useStore, type Account, type AskRoom, type KeyStore, type Room, type Session } from './store.ts'
export type { Box, Boxed, Sent } from './keys.ts'
export type { Cloudside } from './rooms.ts'

type From = { words: string[]; kit: string } | { prf: Bytes; box: string } | { letter: Letter; workspace: string }

const ring = (key: Bytes | null | undefined): Ring | null => (key ? { version: 1, keys: { 1: key } } : null)
const pick = <T extends object, K extends keyof T>(from: T, names: K[]): Pick<T, K> => Object.fromEntries(names.map((name) => [name, from[name]])) as Pick<T, K>

// The account's state and flows the runtime needs; the key material stays in here.
export const keysService = pick(keys, ['account', 'session', 'locked', 'asked', 'kitState', 'vault', 'deviceKey', 'accountDeviceKey', 'signedIn', 'mustBeOn', 'ownedBy',
  'open', 'adopt', 'relock', 'forgetHere', 'removedHere', 'setSession', 'setLocked', 'setAsked', 'setKit',
  'addDevice', 'dropDevices', 'change', 'accountLetter', 'passkeyBox', 'workspaceBox', 'signBox', 'deleteBox', 'boxIsMine'])

// Each team's state and flows the runtime needs.
export const roomKeys = pick(rooms, ['rooms', 'room', 'members', 'roleIn', 'isOwn', 'link', 'linkUntil', 'joinedBy',
  'advance', 'refresh', 'setRoom', 'dropRoom', 'addTeam', 'keepLink', 'invite', 'revoke', 'withRole', 'joinList', 'joinApproved'])

export const keyring = {
  async sealer(): Promise<Sealer> {
    const own = new Map(await Promise.all(rooms.rooms().map(async (room) => [room.workspace.id, await rooms.own(room.workspace.id)] as const)))
    const vault = keys.vault()
    const device = signer(await keys.device())
    const keyOf = ({ use, workspace }: { use: 'workspace' | 'own' | 'vault'; workspace: string }): Ring | null => {
      if (use === 'own') return ring(own.get(workspace))
      if (use === 'vault') return ring(vault)
      const found = rooms.room(workspace)?.workspace
      return found?.key ? { version: found.version, keys: rooms.ring(workspace) } : null
    }
    return {
      by: device.key,
      seal: ({ where, ver, value }: { where: Where; ver: number; value: Value | null }) => seal({ where, ver, value, keys: keyOf, signer: device }),
      open: (row: SealedRow): Promise<Opened | null> => open({ row, keys: keyOf }),
    }
  },

  async lock({ team, bind, plain }: { team: string; bind: string; plain: Bytes }): Promise<string | null> {
    const workspace = rooms.room(team)?.workspace
    const locked = workspace?.key ? await lock({ key: fromBase64(workspace.key), version: workspace.version, bind, plain }) : null
    return locked ? toBase64(locked) : null
  },

  unlock: ({ team, bind, body }: { team: string; bind: string; body: string }): Promise<Bytes | null> => unlock({ keys: rooms.ring(team), bind, locked: fromBase64(body) }),

  inviteId: async (secret: string): Promise<string> => inviteId((await identity(fromBase64(secret))).publicKey),

  async readInvite({ team, secret, from, body }: { team: string; secret: string; from: string; body: string }): Promise<{ card: Identity; letter: InviteLetter } | null> {
    const card = await identity(fromBase64(secret))
    const sealed = await read({ recipient: card, from: fromBase64(from), workspace: team, purpose: 'invite', body: fromBase64(body), allowed: [fromBase64(from)] })
    const plain = sealed && await openInvite({ secret: card.secret, workspace: team, locked: sealed })
    const letter = plain && InviteLetter.safeParse(parseJson(new TextDecoder().decode(plain))).data
    return letter ? { card, letter } : null
  },

  tunnelKey: async (): Promise<{ publicKey: Bytes; secretKey: Bytes }> => boxKey((await keys.device()).secret),

  async approve({ team, email, device, name, server = false }: { team: string; email: string; device: string; name?: string | null; server?: boolean }): Promise<{ list: MemberList; letter: Sent }> {
    const account = keys.account()
    if (!rooms.isOwn(team) || email !== account?.email) return rooms.approve({ ws: team, email, device, name, server })
    const on = keys.mustBeOn()
    const list = await keys.addDevice({ device, name: name ?? null })
    if (!list) throw new HttpError(409, 'That computer is already on your account.')
    return { list, letter: await sealTo({ to: device, purpose: 'workspace-key', workspace: on.workspace.id, plain: await keys.secret() }) }
  },

  remove: ({ team, devices, emails }: { team: string; devices?: string[]; emails?: string[] }) => rooms.teamChange({ ws: team, devices, emails }),
  rotate: (team: string) => rooms.teamChange({ ws: team, rotate: true }),
  kit: keys.newKit,

  async restore({ from, workspaces }: { from: From; workspaces: () => Promise<Boxed[]> }): Promise<Account | null> {
    if ('words' in from) return keys.restore({ ...from, workspaces: await workspaces() })
    const key = 'prf' in from ? await keys.fromPasskey(from) : await openLetter({ found: from.letter, workspace: from.workspace })
    return key ? keys.restoreWith({ key, workspaces: await workspaces() }) : null
  },

  signedHere: async (account: Account): Promise<boolean> => account.list.by === toBase64((await accountDevice(fromBase64(account.key))).publicKey),

  verifyList: ({ anchor, chain }: { anchor: string; chain: MemberList[] }): Promise<MemberListBody | null> => check({ anchor, chain }),
}
