import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { check, concat, header, HEADER, identity, isLocked, newKey, readHeader, sign, suites } from '../../src/vault/public.ts'
import { letter, lock, read, unlock } from '../../src/vault/secret.ts'
import { nearestWord, readKit } from '../../src/vault/kit-file.ts'

test('a header holds versions 0 to 2^32-1 of a known suite and nothing else', () => {
  assert.ok(header({ version: 0 }))
  assert.ok(header({ version: 0xffffffff }))
  for (const version of [-1, 0x100000000, 1.5]) assert.equal(header({ version }), null)
  assert.equal(header({ suite: 99, version: 1 }), null)
})

test('readHeader refuses short bytes, another format and an unknown suite; isLocked needs room for the nonce and tag', () => {
  const head = header({ version: 7 }) ?? new Uint8Array()
  assert.deepEqual(readHeader(head), { suite: 1, version: 7 })
  assert.equal(readHeader(head.slice(0, HEADER - 1)), null)
  assert.equal(readHeader(Uint8Array.of(2, ...head.slice(1))), null)
  assert.equal(readHeader(Uint8Array.of(head[0], 99, ...head.slice(2))), null)
  const room = suites[1].nonce + suites[1].tag
  assert.equal(isLocked(concat([head, new Uint8Array(room)])), true)
  assert.equal(isLocked(concat([head, new Uint8Array(room - 1)])), false)
})

test('unlock refuses a missing key version and bytes too short to be locked', async () => {
  const key = newKey()
  const locked = await lock({ key, version: 2, bind: 'b', plain: Uint8Array.of(1, 2, 3) })
  assert.ok(locked)
  assert.equal(await unlock({ keys: { 1: key }, bind: 'b', locked }), null)
  assert.equal(await unlock({ keys: { 2: key }, bind: 'b', locked: locked.slice(0, HEADER + suites[1].nonce + suites[1].tag - 1) }), null)
  assert.deepEqual(await unlock({ keys: { 2: key }, bind: 'b', locked }), Uint8Array.of(1, 2, 3))
})

test('check refuses keys and signatures of the wrong length, and a small-order signature point', async () => {
  const me = await identity()
  const bytes = Uint8Array.of(1, 2, 3)
  const signature = await sign({ secret: me.secret, bytes })
  assert.equal(await check({ publicKey: me.publicKey, bytes, signature }), true)
  assert.equal(await check({ publicKey: me.publicKey.slice(0, 63), bytes, signature }), false)
  assert.equal(await check({ publicKey: me.publicKey, bytes, signature: signature.slice(0, 63) }), false)
  const smallR = Uint8Array.from(signature)
  smallR.set(new Uint8Array(32).fill(0), 0)
  smallR[0] = 1
  assert.equal(await check({ publicKey: me.publicKey, bytes, signature: smallR }), false)
  const highBit = Uint8Array.from(smallR)
  highBit[31] = 0x80
  assert.equal(await check({ publicKey: me.publicKey, bytes, signature: highBit }), false)
})

test('read refuses an unknown purpose, a sender key of the wrong size, a truncated body and a sender not on the list', async () => {
  const [sender, recipient] = await Promise.all([identity(), identity()])
  const body = await letter({ sender, to: recipient.publicKey, workspace: 'w', purpose: 'pairing', version: 1, plain: Uint8Array.of(9) })
  assert.ok(body)
  const base = { recipient, from: sender.publicKey, workspace: 'w', purpose: 'pairing' as const, body, allowed: [sender.publicKey] }
  assert.deepEqual(await read(base), Uint8Array.of(9))
  assert.equal(await read({ ...base, purpose: 'nope' as 'pairing' }), null)
  assert.equal(await read({ ...base, from: sender.publicKey.slice(0, 63), allowed: [sender.publicKey.slice(0, 63)] }), null)
  assert.equal(await read({ ...base, body: body.slice(0, HEADER + 32 + 64 + 16 - 1) }), null)
  assert.equal(await read({ ...base, allowed: [] }), null)
})

test('a kit file reads its mark case-insensitively, keeps the first valid window and suggests the closest word', () => {
  const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ')
  const kit = readKit(`OpenHut-Kit/1 MO@Example.com k-abcd-12ef\n${words.join(' ')}`)
  assert.ok(kit)
  assert.deepEqual([kit.email, kit.kitId], ['mo@example.com', 'K-ABCD-12EF'])
  assert.deepEqual([readKit(words.join(' '))?.email, readKit(words.join(' '))?.kitId], [null, null])
  assert.equal(kit.valid, true)
  assert.deepEqual(kit.words, words)
  const loose = readKit(`zoo ${words.join(' ')} zoo`)
  assert.deepEqual(loose?.words, words)
  assert.equal(readKit(words.slice(0, 11).join(' ')), null)
  assert.equal(nearestWord('abandom'), 'abandon')
  assert.equal(nearestWord(wordlist[5]), wordlist[5])
})
