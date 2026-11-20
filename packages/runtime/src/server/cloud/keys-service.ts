import { execFileSync } from 'node:child_process'
import { createHash, randomInt } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/mini'
import { MemberList, type RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { signList } from '@openhut/common/cloud/member-list.ts'
import { equal, fromBase64, fromWords, identity, lock, newKey, newWords, toBase64, unlock, type Bytes, type Identity } from '@openhut/common/vault/vault.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { seal, unseal } from '../platform/secrets.ts'

const ROW = 'cloud_keys'
const FILE = join(config.dataDir, 'cloud-keys.sealed')
const KIT = z.object({ box: z.string(), savedAt: z.string() })
const Stored = z.object({
  device: z.string(),
  machine: z.string(),
  account: z.optional(z.object({ sub: z.string(), email: z.string(), key: z.string(), workspace: z.object({ id: z.string(), key: z.string(), version: z.number() }), list: MemberList })),
  kit: z.optional(KIT),
  pending: z.optional(z.object({ box: z.string(), words: z.array(z.string()), ask: z.array(z.number()) })),
  session: z.optional(z.object({ token: z.string(), expiresAt: z.string() })),
})
type Stored = z.infer<typeof Stored>
export type Account = NonNullable<Stored['account']>
export type Session = NonNullable<Stored['session']>

const keychain = Boolean(config.secret)
const machine = createHash('sha256').update(machineId()).digest('hex')
let stored = await load()

export const keysService = {
  keyStore: (): 'keychain' | 'file' => keychain ? 'keychain' : 'file',

  async device(): Promise<Identity> {
    return identity(fromBase64((await keys()).device))
  },

  account: (): Account | undefined => stored?.account,
  session: (): Session | undefined => stored?.session,
  kit: (): { savedAt: string } | null => stored?.kit ? { savedAt: stored.kit.savedAt } : null,

  async setSession(session: Session | undefined): Promise<void> {
    await save({ ...await keys(), session })
  },

  async open({ sub, email }: { sub: string; email: string }): Promise<Account> {
    const current = await keys()
    if (current.account?.sub === sub) return current.account
    const device = await identity(fromBase64(current.device))
    const id = toBase64(newKey(12))
    const list = await signList({ signer: device, body: { workspace: id, version: 1, previous: null, members: [{ email, role: 'owner', devices: [toBase64(device.publicKey)] }], invites: [], removed: [] } })
    const account = { sub, email, key: toBase64(newKey()), workspace: { id, key: toBase64(newKey()), version: 1 }, list }
    await save({ device: current.device, machine, account })
    return account
  },

  async newKit(): Promise<RecoveryKit> {
    const current = await keys()
    if (!current.account) return { object: 'recovery_kit', words: [], ask: [] }
    const { words, box } = await kitFor(current.account)
    const ask = pick()
    await save({ ...current, pending: { box, words, ask } })
    return { object: 'recovery_kit', words, ask }
  },

  async confirmKit(answers: string[]): Promise<boolean> {
    const current = await keys()
    const pending = current.pending
    const right = pending && pending.ask.length === answers.length && pending.ask.every((index, i) => pending.words[index] === answers[i]?.trim().toLowerCase())
    if (!pending || !right) return false
    await save({ ...current, pending: undefined, kit: { box: pending.box, savedAt: new Date().toISOString() } })
    return true
  },

  async fromKit(words: string[]): Promise<{ key: Bytes; kit: RecoveryKit } | null> {
    const current = await keys()
    const kitKey = await fromWords(words)
    if (!kitKey || !current.account || !current.kit) return null
    const key = await unlock({ keys: { 1: kitKey }, bind: bindOf(current.account), locked: fromBase64(current.kit.box) })
    if (!key || !equal({ a: key, b: fromBase64(current.account.key) })) return null
    const next = await kitFor(current.account)
    await save({ ...current, pending: undefined, kit: { box: next.box, savedAt: new Date().toISOString() } })
    return { key, kit: { object: 'recovery_kit', words: next.words, ask: [] } }
  },
}

async function kitFor(account: Account): Promise<{ words: string[]; box: string }> {
  const { words, key } = await newWords()
  const box = await lock({ key, version: 1, bind: bindOf(account), plain: fromBase64(account.key) })
  return { words, box: toBase64(box ?? new Uint8Array()) }
}

function bindOf(account: Account): string {
  return `account/${account.sub}/kit`
}

function pick(): number[] {
  const first = randomInt(0, 6)
  return [first, randomInt(6, 12)]
}

async function keys(): Promise<Stored> {
  if (stored && stored.machine === machine) return stored
  stored = { device: toBase64(newKey()), machine }
  await save(stored)
  return stored
}

async function save(next: Stored): Promise<void> {
  stored = next
  const sealed = seal(JSON.stringify(next))
  if (!keychain) return writeFileSync(FILE, sealed, { mode: 0o600 })
  await db.insertInto('install_setting').values({ name: ROW, value: sealed }).onConflict((oc) => oc.column('name').doUpdateSet({ value: sealed })).execute()
}

async function load(): Promise<Stored | undefined> {
  const sealed = keychain
    ? (await db.selectFrom('install_setting').select('value').where('name', '=', ROW).executeTakeFirst())?.value
    : existsSync(FILE) ? readFileSync(FILE, 'utf8') : undefined
  return sealed ? z.safeParse(Stored, JSON.parse(unseal(sealed))).data : undefined
}

function machineId(): string {
  try {
    if (process.platform === 'darwin') return /"IOPlatformUUID" = "([^"]+)"/.exec(execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' }))?.[1] ?? ''
    return readFileSync('/etc/machine-id', 'utf8').trim()
  } catch {
    return ''
  }
}
