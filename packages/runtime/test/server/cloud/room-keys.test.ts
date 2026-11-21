import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrate } from '../../../src/server/platform/db.ts'
import { accountDevice, keysService } from '../../../src/server/cloud/keys-service.ts'
import { roomKeys } from '../../../src/server/cloud/room-keys.ts'
import { anchorOf, signList } from '@openhut/common/cloud/member-list.ts'
import { identity, letter, newKey, toBase64 } from '@openhut/common/vault/vault.ts'

await migrate()

test('a member list that lands while an account-key letter is being taken keeps the new account key', async () => {
  const account = await keysService.open({ sub: 'dev-mo', email: 'mo@example.com' })
  const me = await keysService.device()
  const macA = await identity()
  const key = newKey()
  const kit = toBase64((await accountDevice(key)).publicKey)
  const oldKit = toBase64((await accountDevice(Buffer.from(account.key, 'base64'))).publicKey)
  const body = roomKeys.members()
  assert.ok(body)
  const at = Date.now()
  const mine = body.members[0]
  const devices = [...mine.devices.filter((each) => each !== oldKit), toBase64(macA.publicKey), kit]
  const second = await signList({ signer: me, body: { ...body, version: 2, previous: await anchorOf(account.list), at, members: [{ ...mine, devices, kit }], removed: [...body.removed, oldKit], added: { ...Object.fromEntries(Object.entries(body.added ?? {}).filter(([each]) => each !== oldKit)), [toBase64(macA.publicKey)]: at, [kit]: at } } })
  assert.ok(await roomKeys.advance({ lists: [second] }))
  const phone = await identity()
  const third = await signList({ signer: me, body: { ...body, version: 3, previous: await anchorOf(second), at, members: [{ ...mine, devices: [...devices, toBase64(phone.publicKey)], kit }], removed: [...body.removed, oldKit], added: { ...Object.fromEntries(Object.entries(body.added ?? {}).filter(([each]) => each !== oldKit)), [toBase64(macA.publicKey)]: at, [kit]: at, [toBase64(phone.publicKey)]: at } } })
  const sealed = await letter({ sender: macA, to: me.publicKey, workspace: account.workspace.id, purpose: 'account-key', version: 1, plain: key })
  const found = [{ id: 'let_1', object: 'letter' as const, workspace: account.workspace.id, to: toBase64(me.publicKey), from: toBase64(macA.publicKey), purpose: 'account-key' as const, body: toBase64(sealed ?? new Uint8Array()), createdAt: new Date().toISOString() }]
  const advanced = roomKeys.advance({ lists: [third] })
  assert.deepEqual(await roomKeys.takeLetters({ found }), ['let_1'])
  assert.ok(await advanced)
  assert.equal(keysService.account()?.key, toBase64(key))
  assert.equal(roomKeys.members()?.version, 3)
})
