import { InviteLetter, parseJson, type MemberList, type MemberListBody } from '../cloud/cloud.ts'
import { check } from '../cloud/member-list.ts'
import type { Sealer } from '../cloud/records.ts'
import { signer, type Keyring as Ring, type Opened, type Value, type Where } from '../records/row.ts'
import { open, seal } from '../records/seal.ts'
import type { SealedRow } from '../records/wire.ts'
import { fromBase64, identity, toBase64, type Bytes } from '../vault/public.ts'
import { lock, openInvite, read, unlock } from '../vault/secret.ts'
import { keysService } from './keys.ts'
import { roomKeys } from './rooms.ts'

export { keyStore, useStore, type Account, type AskRoom, type KeyStore, type Room, type Session, type Stored } from './store.ts'
export { keysService, roomKeys }

const ring = (key: Bytes | null | undefined): Ring | null => (key ? { version: 1, keys: { 1: key } } : null)

export const keyring = {
  async sealer(): Promise<Sealer> {
    const own = new Map(await Promise.all(roomKeys.rooms().map(async (room) => [room.workspace.id, await roomKeys.own(room.workspace.id)] as const)))
    const vault = keysService.vault()
    const device = signer(await keysService.device())
    const keys = ({ use, workspace }: { use: 'workspace' | 'own' | 'vault'; workspace: string }): Ring | null => {
      if (use === 'own') return ring(own.get(workspace))
      if (use === 'vault') return ring(vault)
      const found = roomKeys.room(workspace)?.workspace
      return found?.key ? { version: found.version, keys: roomKeys.ring(workspace) } : null
    }
    return {
      by: device.key,
      seal: ({ where, ver, value }: { where: Where; ver: number; value: Value | null }) => seal({ where, ver, value, keys, signer: device }),
      open: (row: SealedRow): Promise<Opened | null> => open({ row, keys }),
    }
  },

  async lock({ team, bind, plain }: { team: string; bind: string; plain: Bytes }): Promise<string | null> {
    const workspace = roomKeys.room(team)?.workspace
    const locked = workspace?.key ? await lock({ key: fromBase64(workspace.key), version: workspace.version, bind, plain }) : null
    return locked ? toBase64(locked) : null
  },

  unlock: ({ team, bind, body }: { team: string; bind: string; body: string }): Promise<Bytes | null> => unlock({ keys: roomKeys.ring(team), bind, locked: fromBase64(body) }),

  async readInvite({ team, secret, from, body }: { team: string; secret: string; from: string; body: string }): Promise<{ card: Awaited<ReturnType<typeof identity>>; letter: InviteLetter } | null> {
    const card = await identity(fromBase64(secret))
    const sealed = await read({ recipient: card, from: fromBase64(from), workspace: team, purpose: 'invite', body: fromBase64(body), allowed: [fromBase64(from)] })
    const plain = sealed && await openInvite({ secret: card.secret, workspace: team, locked: sealed })
    const letter = plain && InviteLetter.safeParse(parseJson(new TextDecoder().decode(plain))).data
    return letter ? { card, letter } : null
  },

  approve: roomKeys.approve,
  remove: ({ team, devices, emails }: { team: string; devices?: string[]; emails?: string[] }) => roomKeys.teamChange({ ws: team, devices, emails }),
  rotate: (team: string) => roomKeys.teamChange({ ws: team, rotate: true }),
  kit: keysService.newKit,
  restore: keysService.restore,
  verifyList: ({ anchor, chain }: { anchor: string; chain: MemberList[] }): Promise<MemberListBody | null> => check({ anchor, chain }),
}
