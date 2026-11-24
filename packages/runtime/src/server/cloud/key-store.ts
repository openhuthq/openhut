import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/mini'
import { newKey, toBase64 } from '@openhut/common/vault/public.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { seal, unseal } from '../platform/secrets.ts'
import { Stored, useStore } from '@openhut/common/keyring/keyring.ts'
import { deviceName } from './keys-service.ts'

export type { Account, AskRoom, Room, Session, Stored } from '@openhut/common/keyring/keyring.ts'

const ROW = 'cloud_keys'
const FILE = join(config.dataDir, 'cloud-keys.sealed')
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

useStore({ store: keyStore, deviceName })

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
