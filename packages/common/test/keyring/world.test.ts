import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyring, useStore, type Stored } from '../../src/keyring/keyring.ts'
import { keysService } from '../../src/keyring/keys.ts'
import { roomKeys } from '../../src/keyring/rooms.ts'
import { padded } from '../../src/records/row.ts'
import { fromBase64, identity, newKey, toBase64, type Bytes } from '../../src/vault/public.ts'

const SECRET = 'Secret Agent Zebra'
const TOKEN = 'session-token-that-never-leaves'
let stored: Stored | undefined = { device: toBase64(newKey()), machine: 'm', session: { token: TOKEN, refresh: 'refresh-token-that-never-leaves', expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }
useStore({ deviceName: () => 'Test Mac', store: { machine: 'm', kind: () => 'file', current: () => stored, read: async () => stored ?? { device: toBase64(newKey()), machine: 'm' }, write: async (next) => { stored = next } } })

const sent: unknown[] = []
const cloud = <T>(value: T): T => (sent.push(value), value)

function forms(bytes: Bytes): string[] {
  const text = Buffer.from(bytes)
  return [toBase64(bytes), text.toString('base64'), text.toString('hex'), text.toString('latin1')].filter((each) => each.length >= 8)
}

test('the Cloud’s world: no plaintext, key or token appears in any byte a keyring operation hands to the Cloud', async () => {
  const account = await keysService.open({ sub: 'sub-mo', email: 'mo@example.com', home: 'HomeTeam0001' })
  const teammate = toBase64((await identity()).publicKey)
  const laptop = toBase64((await identity()).publicKey)
  cloud({ list: account.list, box: await keysService.workspaceBox({ account }) })
  cloud(await keysService.signBox({ account, name: 'kit-confirmed', body: 'x', savedAt: 1 }))
  const kit = await keysService.newKit()
  cloud(kit.box)
  cloud(await keysService.passkeyBox(newKey()))
  cloud(await keysService.accountLetter(laptop))
  cloud(await keysService.addDevice({ device: laptop, name: 'Laptop' }))

  const sealer = await keyring.sealer()
  const where = { collection: 'agent' as const, workspace: account.workspace.id, parent: 'mo@example.com', id: 'ag_world0001' }
  cloud(await sealer.seal({ where, ver: 1, value: { workspace: { name: SECRET }, own: { notes: SECRET }, vault: { token: SECRET } } }))
  cloud(await keyring.lock({ team: account.workspace.id, bind: 'beat/x', plain: padded({ json: JSON.stringify({ name: SECRET }) }) ?? new Uint8Array() }))

  const team = await roomKeys.createTeam()
  cloud(team.list)
  const body = roomKeys.members(team.workspace.id)
  assert.ok(body)
  const grown = await roomKeys.teamChange({ ws: team.workspace.id })
  await roomKeys.setRoom(grown.room)
  cloud({ list: grown.list, letters: grown.letters })
  const invite = await roomKeys.invite({ ws: team.workspace.id, email: 'ana@example.com', role: 'member', name: SECRET })
  cloud({ list: invite.list, id: invite.id, key: invite.key, body: invite.body })
  await roomKeys.setRoom({ ...grown.room, list: invite.list })
  cloud(await roomKeys.welcomeLetters({ ws: team.workspace.id, devices: [teammate] }))
  const rotated = await keyring.rotate(team.workspace.id)
  cloud({ list: rotated.list, letters: rotated.letters })
  await roomKeys.setRoom(rotated.room)
  const changed = await keysService.change()
  cloud({ list: changed.list, letters: changed.letters })

  const now = stored?.account
  assert.ok(now)
  const secrets: Bytes[] = [fromBase64(account.key), fromBase64(account.vault ?? ''), fromBase64(account.workspace.key), fromBase64(stored?.device ?? ''), fromBase64(team.workspace.key), fromBase64(rotated.room.workspace.key), fromBase64(now.key)]
  const wire = JSON.stringify(sent)
  const bytes = Buffer.from(wire).toString('latin1')
  for (const secret of secrets) for (const form of forms(secret)) assert.equal(wire.includes(form), false, 'a raw key reached the Cloud')
  for (const word of kit.words) assert.equal(new RegExp(`\\b${word}\\b`).test(wire.replace(/"[A-Za-z0-9_-]{20,}"/g, '')), false, 'a kit word reached the Cloud')
  for (const plain of [SECRET, TOKEN, 'refresh-token-that-never-leaves']) {
    assert.equal(bytes.includes(plain), false, `${plain} reached the Cloud`)
    assert.equal(wire.includes(Buffer.from(plain).toString('base64url')), false)
  }
  assert.equal(sent.filter((each) => each !== null && each !== undefined).length, sent.length, 'every operation produced something to send')
  assert.equal(sent.length, 14)
})
