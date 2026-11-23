import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/mini'
import { MemberList } from '@openhut/common/cloud/cloud.ts'
import { newKey, toBase64 } from '@openhut/common/vault/vault.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { seal, unseal } from '../platform/secrets.ts'

const ROW = 'cloud_keys'
const FILE = join(config.dataDir, 'cloud-keys.sealed')
const KIT = z.object({ box: z.string(), savedAt: z.string(), confirmed: z.optional(z.boolean()) })
export const Keys = z.object({ key: z.string(), version: z.number(), old: z.optional(z.record(z.string(), z.string())), slot: z.optional(z.string()), own: z.optional(z.string()) })
const Room = z.object({ workspace: z.object({ id: z.string(), ...Keys.shape }), list: MemberList, first: z.optional(MemberList) })
const Stored = z.object({
  device: z.string(),
  machine: z.string(),
  account: z.optional(z.object({ sub: z.string(), email: z.string(), key: z.string(), vault: z.optional(z.string()), ...Room.shape, teams: z.optional(z.array(Room)), links: z.optional(z.record(z.string(), z.string())) })),
  kit: z.optional(KIT),
  locked: z.optional(z.object({ sub: z.string(), email: z.string() })),
  session: z.optional(z.object({ token: z.string(), refresh: z.optional(z.string()), expiresAt: z.string() })),
  asking: z.optional(z.array(z.object({ id: z.string(), admins: z.array(z.string()), own: z.optional(z.boolean()), nonce: z.optional(z.string()) }))),
})
export type Stored = z.infer<typeof Stored>
export type Account = NonNullable<Stored['account']>
export type Session = NonNullable<Stored['session']>
export type AskRoom = NonNullable<Stored['asking']>[number]
export type Room = z.infer<typeof Room>

const keychain = Boolean(config.secret)
const machine = createHash('sha256').update(machineId()).digest('hex')
let stored = await load()

export const keyStore = {
  machine,

  kind: (): 'keychain' | 'file' => keychain ? 'keychain' : 'file',

  current: (): Stored | undefined => stored,

  async read(): Promise<Stored> {
    if (stored) return stored
    const fresh = { device: toBase64(newKey()), machine }
    await keyStore.write(fresh)
    return fresh
  },

  async write(next: Stored): Promise<void> {
    stored = next
    const sealed = seal(JSON.stringify(next))
    if (!keychain) return writeFileSync(FILE, sealed, { mode: 0o600 })
    await db.insertInto('install_setting').values({ name: ROW, value: sealed }).onConflict((oc) => oc.column('name').doUpdateSet({ value: sealed })).execute()
  },
}

async function load(): Promise<Stored | undefined> {
  const sealed = keychain
    ? (await db.selectFrom('install_setting').select('value').where('name', '=', ROW).executeTakeFirst())?.value
    : existsSync(FILE) ? readFileSync(FILE, 'utf8') : undefined
  const found = sealed ? z.safeParse(Stored, JSON.parse(unseal(sealed))).data : undefined
  return found?.machine === machine ? found : undefined
}

function machineId(): string {
  try {
    if (process.platform === 'darwin') return /"IOPlatformUUID" = "([^"]+)"/.exec(execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' }))?.[1] ?? ''
    return readFileSync('/etc/machine-id', 'utf8').trim()
  } catch {
    return ''
  }
}
