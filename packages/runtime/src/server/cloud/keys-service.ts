import { execFileSync } from 'node:child_process'
import { createHash, randomInt } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/mini'
import { checkProof, MemberList, MemberListBody, parseJson, signProof, type CloudSession } from '@openhut/common/cloud/cloud.ts'
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

  deviceKey: async (): Promise<string> => toBase64((await keysService.device()).publicKey),

  async accountDeviceKey(): Promise<string | null> {
    const key = stored?.account?.key
    return key ? toBase64((await accountDevice(fromBase64(key))).publicKey) : null
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
    const runtime = stored?.account && !stored.account.key ? stored.account.workspace.id : undefined
    const next = await cloud.session({ grantType: 'refresh', session: session.token, signedAt, signature }).catch((err: unknown) => {
      if (!runtime) throw err
      return keysService.deviceSession(runtime)
    })
    await keysService.setSession({ token: next.token, expiresAt: next.expiresAt })
    return next.token
  },

  async deviceSession(workspace: string): Promise<CloudSession> {
    const device = await keysService.device()
    const signedAt = Date.now()
    const signature = await signProof({ signer: device, proof: 'device', parts: [workspace, String(signedAt)] })
    return cloud.deviceSession({ workspace, device: toBase64(device.publicKey), signedAt, signature })
  },

  async addDevice(device: string): Promise<MemberList | null> {
    const account = (await keys()).account
    const body = bodyOf(account?.list)
    if (!account || !body) return null
    if (body.members.some((member) => member.devices.includes(device))) return null
    const members = body.members.map((member) => member.email === account.email ? { ...member, devices: [...member.devices, device] } : member)
    return signList({ signer: await keysService.device(), body: { ...body, version: body.version + 1, previous: await anchorOf(account.list), members, runtimes: [...body.runtimes ?? [], device] } })
  },

  async joinAsRuntime({ session, workspace, chain }: { session: CloudSession; workspace: { id: string; key: string; version: number }; chain: MemberList[] }): Promise<void> {
    const list = chain.at(-1)
    if (!list || !chain[0]) throw new HttpError(502, 'OpenHut Cloud sent no member list.')
    const account = { sub: session.sub, email: session.email, key: '', workspace, list, first: chain[0] }
    await save({ device: (await keys()).device, machine, account, session: { token: session.token, expiresAt: session.expiresAt } })
  },

  async workspaceBox(account: Account): Promise<{ id: string; key: string; by: string; signature: string }> {
    const box = toBase64(await lock({ key: fromBase64(account.key), version: 1, bind: workspaceBind({ account, id: account.workspace.id }), plain: await workspacePlain(account) }) ?? new Uint8Array())
    const { by, signature } = await keysService.signBox({ account, name: `workspace/${account.workspace.id}`, body: box })
    return { id: account.workspace.id, key: box, by, signature }
  },

  async signBox({ account, name, body }: { account: Account; name: string; body: string }): Promise<{ body: string; by: string; signature: string }> {
    const signer = await accountDevice(fromBase64(account.key))
    return { body, by: toBase64(signer.publicKey), signature: await signProof({ signer, proof: 'key-box', parts: [account.sub, name, body] }) }
  },

  async boxIsMine({ account, name, box }: { account: Account; name: string; box: { body: string; by?: string; signature?: string } }): Promise<boolean> {
    const by = toBase64((await accountDevice(fromBase64(account.key))).publicKey)
    if (box.by !== by || !box.signature) return false
    if (!await checkProof({ device: by, proof: 'key-box', parts: [account.sub, name, box.body], signature: box.signature })) return false
    if (name === 'kit') return true
    const plain = await unlock({ keys: { 1: fromBase64(account.key) }, bind: workspaceBind({ account, id: account.workspace.id }), locked: fromBase64(box.body) })
    return Boolean(plain && equal({ a: plain, b: await workspacePlain(account) }))
  },

  async setKit(kit: { box: string; savedAt: string } | undefined): Promise<void> {
    await save({ ...await keys(), kit })
  },

  async relock(locked: { sub: string; email: string }): Promise<void> {
    const current = await keys()
    await save({ device: current.device, machine, session: current.session, locked })
  },

  async restore({ words, kit, workspaces }: { words: string[]; kit: string; workspaces: { id: string; key: string; chain: MemberList[] }[] }): Promise<Account | null> {
    const current = await keys()
    const kitKey = await fromWords(words)
    if (!kitKey || !current.locked) return null
    const { sub, email } = current.locked
    const key = await unlock({ keys: { 1: kitKey }, bind: `account/${sub}/kit`, locked: fromBase64(kit) })
    if (!key) return null
    for (const workspace of workspaces) {
      const account = await restoreFrom({ key, workspace, sub, email, device: current.device })
      if (account) return account
    }
    return null
  },

  async adopt({ account, kit }: { account: Account; kit?: { box: string; savedAt: string } }): Promise<void> {
    await save({ device: (await keys()).device, machine, account, kit, session: stored?.session })
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
    if (other && other.sub !== sub) throw new HttpError(409, `This ${process.platform === 'darwin' ? 'Mac' : 'computer'} is signed in to ${other.email}. ${stored?.account && !stored.kit ? 'Sign in with that account and save a recovery kit first.' : 'Sign in with that account.'}`)
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

  async newKit(): Promise<{ words: string[]; box: string; ask: number[] }> {
    const account = (await keys()).account
    if (!account) throw new HttpError(409, 'Turn on OpenHut Cloud before making a recovery kit.')
    return { ...await kitFor(account), ask: pick() }
  },

  async saveKit(box: string): Promise<void> {
    await save({ ...await keys(), kit: { box, savedAt: new Date().toISOString() } })
  },

  keptAccount: (): string | null => stored?.account && stored.kit ? stored.account.email : null,

  async forget(): Promise<void> {
    const current = await keys()
    if (current.session) throw new HttpError(409, 'Sign out of OpenHut Cloud first.')
    if (!current.account) return
    if (!current.kit) throw new HttpError(409, `Save a recovery kit for ${current.account.email} first. Without one, nobody can open its backup again.`)
    await save({ device: toBase64(newKey()), machine })
  },

  async fromKit(words: string[]): Promise<{ key: Bytes; kit: { words: string[] } } | null> {
    const current = await keys()
    const kitKey = await fromWords(words)
    if (!kitKey || !current.account || !current.kit) return null
    const key = await unlock({ keys: { 1: kitKey }, bind: bindOf(current.account), locked: fromBase64(current.kit.box) })
    if (!key || !equal({ a: key, b: fromBase64(current.account.key) })) return null
    const next = await kitFor(current.account)
    await save({ ...current, kit: { box: next.box, savedAt: new Date().toISOString() } })
    return { key, kit: { words: next.words } }
  },
}

async function restoreFrom({ key, workspace, sub, email, device }: { key: Bytes; workspace: { id: string; key: string; chain: MemberList[] }; sub: string; email: string; device: string }): Promise<Account | null> {
  const { chain } = workspace
  const plain = await unlock({ keys: { 1: key }, bind: `account/${sub}/workspace/${workspace.id}`, locked: fromBase64(workspace.key) })
  const body = plain && chain[0] && await check({ anchor: toBase64(plain.slice(32)), chain })
  const last = chain.at(-1)
  if (!plain || !body || !last || body.workspace !== workspace.id) return null
  const me = toBase64((await identity(fromBase64(device))).publicKey)
  const members = body.members.map((member) => member.email === email && !member.devices.includes(me) ? { ...member, devices: [...member.devices, me] } : member)
  const list = await signList({ signer: await accountDevice(key), body: { ...body, version: body.version + 1, previous: await anchorOf(last), members } })
  return { sub, email, key: toBase64(key), workspace: { id: workspace.id, key: toBase64(plain.slice(0, 32)), version: body.keyVersion ?? 1 }, list, first: chain[0] }
}

async function workspacePlain(account: Account): Promise<Bytes> {
  return concat([fromBase64(account.workspace.key), fromBase64(await anchorOf(firstOf(account)))])
}

function workspaceBind({ account, id }: { account: Account; id: string }): string {
  return `account/${account.sub}/workspace/${id}`
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
