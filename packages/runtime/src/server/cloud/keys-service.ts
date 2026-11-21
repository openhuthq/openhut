import { execFileSync } from 'node:child_process'
import { createHash, randomInt } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/mini'
import { MemberList, MemberListBody, parseJson, signProof, type RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, check, signList } from '@openhut/common/cloud/member-list.ts'
import { concat, equal, fromBase64, fromWords, identity, lock, newKey, newWords, slot, toBase64, unlock, type Bytes, type Identity } from '@openhut/common/vault/vault.ts'
import { cloud } from '../platform/cloud.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { HttpError } from '../platform/http-error.ts'
import { seal, unseal } from '../platform/secrets.ts'

const ROW = 'cloud_keys'
const FILE = join(config.dataDir, 'cloud-keys.sealed')
const REFRESH_EARLY_MS = 5 * 60_000
const KIT = z.object({ box: z.string(), savedAt: z.string() })
const Stored = z.object({
  device: z.string(),
  machine: z.string(),
  account: z.optional(z.object({ sub: z.string(), email: z.string(), key: z.string(), workspace: z.object({ id: z.string(), key: z.string(), version: z.number() }), list: MemberList, first: z.optional(MemberList) })),
  kit: z.optional(KIT),
  locked: z.optional(z.object({ sub: z.string(), email: z.string() })),
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
  locked: (): { sub: string; email: string } | undefined => stored?.locked,
  members: (): MemberListBody | undefined => bodyOf(stored?.account?.list),
  kitBox: (): string | undefined => stored?.kit?.box,

  async setLocked(locked: { sub: string; email: string } | undefined): Promise<void> {
    await save({ ...await keys(), locked })
  },

  async token(): Promise<string> {
    const session = stored?.session
    if (!session) throw new HttpError(409, 'Turn on OpenHut Cloud first.')
    if (Date.parse(session.expiresAt) - Date.now() > REFRESH_EARLY_MS) return session.token
    const signedAt = Date.now()
    const signature = await signProof({ signer: await keysService.device(), proof: 'refresh', parts: [session.token, String(signedAt)] })
    const next = await cloud.session({ grantType: 'refresh', session: session.token, signedAt, signature })
    await keysService.setSession({ token: next.token, expiresAt: next.expiresAt })
    return next.token
  },

  async workspaceBox(account: Account): Promise<{ id: string; key: string }> {
    const plain = concat([fromBase64(account.workspace.key), fromBase64(await anchorOf(firstOf(account)))])
    const box = await lock({ key: fromBase64(account.key), version: 1, bind: `account/${account.sub}/workspace/${account.workspace.id}`, plain })
    return { id: account.workspace.id, key: toBase64(box ?? new Uint8Array()) }
  },

  async restore({ words, kit, workspace, chain }: { words: string[]; kit: string; workspace: { id: string; key: string }; chain: MemberList[] }): Promise<Account | null> {
    const current = await keys()
    const kitKey = await fromWords(words)
    if (!kitKey || !current.locked) return null
    const { sub, email } = current.locked
    const key = await unlock({ keys: { 1: kitKey }, bind: `account/${sub}/kit`, locked: fromBase64(kit) })
    const plain = key && await unlock({ keys: { 1: key }, bind: `account/${sub}/workspace/${workspace.id}`, locked: fromBase64(workspace.key) })
    const body = plain && chain[0] && await check({ anchor: toBase64(plain.slice(32)), chain })
    const last = chain.at(-1)
    if (!key || !plain || !body || !last || body.workspace !== workspace.id) return null
    const device = toBase64((await identity(fromBase64(current.device))).publicKey)
    const members = body.members.map((member) => member.email === email && !member.devices.includes(device) ? { ...member, devices: [...member.devices, device] } : member)
    const list = await signList({ signer: await accountDevice(key), body: { ...body, version: body.version + 1, previous: await anchorOf(last), members } })
    return { sub, email, key: toBase64(key), workspace: { id: workspace.id, key: toBase64(plain.slice(0, 32)), version: body.keyVersion ?? 1 }, list, first: chain[0] }
  },

  async adopt(account: Account): Promise<void> {
    await save({ device: (await keys()).device, machine, account, session: stored?.session })
  },

  async advance(lists: MemberList[]): Promise<MemberListBody | null> {
    const current = await keys()
    if (!current.account || !lists.length) return null
    const body = await check({ anchor: await anchorOf(current.account.list), chain: [current.account.list, ...lists] })
    const last = lists.at(-1)
    if (body && last) await save({ ...current, account: { ...current.account, list: last } })
    return body
  },
  session: (): Session | undefined => stored?.session,
  kit: (): { savedAt: string } | null => stored?.kit ? { savedAt: stored.kit.savedAt } : null,

  async setSession(session: Session | undefined): Promise<void> {
    await save({ ...await keys(), session })
  },

  ownedBy({ sub }: { sub: string }): void {
    const other = stored?.account ?? stored?.locked
    if (other && other.sub !== sub) throw new HttpError(409, `This ${process.platform === 'darwin' ? 'Mac' : 'computer'} is signed in to ${other.email}. Sign in with that account.`)
  },

  async open({ sub, email }: { sub: string; email: string }): Promise<Account> {
    const current = await keys()
    if (current.account?.sub === sub) return current.account
    keysService.ownedBy({ sub })
    const device = await identity(fromBase64(current.device))
    const id = toBase64(newKey(12))
    const key = newKey()
    const devices = [toBase64(device.publicKey), toBase64((await accountDevice(key)).publicKey)]
    const list = await signList({ signer: device, body: { workspace: id, version: 1, previous: null, members: [{ email, role: 'owner', devices }], invites: [], removed: [] } })
    const account = { sub, email, key: toBase64(key), workspace: { id, key: toBase64(newKey()), version: 1 }, list, first: list }
    await save({ device: current.device, machine, account, session: current.session })
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

async function accountDevice(key: Bytes): Promise<Identity> {
  return identity(fromBase64(await slot({ key, path: 'account-device' })))
}

function firstOf(account: Account): MemberList {
  return account.first ?? account.list
}

function bodyOf(list: MemberList | undefined): MemberListBody | undefined {
  return list && MemberListBody.safeParse(parseJson(new TextDecoder().decode(fromBase64(list.bytes)))).data
}

function bindOf(account: Account): string {
  return `account/${account.sub}/kit`
}

function pick(): number[] {
  const first = randomInt(0, 6)
  return [first, randomInt(6, 12)]
}

async function keys(): Promise<Stored> {
  if (stored) return stored
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
