import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kitId, kitText, kitWord, nearestWord, readKit } from '../../src/vault/kit-file.ts'

const WORDS = ['ocean', 'ribbon', 'canyon', 'pepper', 'garden', 'orbit', 'tiger', 'lamp', 'maple', 'velvet', 'harbor', 'bread']
const KIT = { email: 'mo@example.com', madeAt: '2026-11-22T12:00:00.000Z', device: 'Mo\'s MacBook Pro', kitId: 'K-7F3A-29C1', words: WORDS }

test('kitText lays the kit out as the spec shows, and readKit reads it back', () => {
  const text = kitText(KIT)
  assert.match(text, /^OpenHut Recovery Kit\nAccount   mo@example\.com\nMade      22 Nov 2026, on Mo's MacBook Pro\nKit       K-7F3A-29C1\n/)
  assert.ok(text.includes('\n 1. ocean      5. garden      9. maple\n 2. ribbon     6. orbit      10. velvet\n'))
  assert.ok(text.endsWith('\nopenhut-kit/1 mo@example.com K-7F3A-29C1\n'))
  assert.deepEqual(readKit(text), { words: WORDS, email: 'mo@example.com', kitId: 'K-7F3A-29C1', valid: true })
})

test('readKit finds the kit in a paste a password manager reflowed', () => {
  const reflowed = kitText(KIT).replace(/\s+/g, ' ')
  assert.deepEqual(readKit(`Notes: ${reflowed} more notes`), { words: WORDS, email: 'mo@example.com', kitId: 'K-7F3A-29C1', valid: true })
  assert.deepEqual(readKit(WORDS.join('\n'))?.words, WORDS)
})

test('readKit reads the old numbered kit, with no account or kit id', () => {
  const old = `OpenHut recovery kit\n\nThese 12 words and your Google account open your cloud. Keep them offline.\n\n${WORDS.map((word, index) => `${index + 1}. ${word}`).join('\n')}\n`
  assert.deepEqual(readKit(old), { words: WORDS, email: null, kitId: null, valid: true })
})

test('a typo fails the checksum and the nearest kit word is suggested', () => {
  const typo = WORDS.with(4, 'gardn')
  assert.equal(readKit(kitText({ ...KIT, words: typo }))?.valid, false)
  assert.equal(kitWord('gardn'), false)
  assert.equal(nearestWord('gardn'), 'garden')
  assert.equal(readKit(kitText({ ...KIT, words: WORDS.with(0, 'river') }))?.valid, false)
})

test('a kit of another account names that account', () => {
  assert.equal(readKit(kitText({ ...KIT, email: 'anna@example.com' }))?.email, 'anna@example.com')
})

test('readKit finds nothing in text without a kit', () => {
  assert.equal(readKit('hello there, nothing to see'), null)
})

test('kitId is a short stable fingerprint of the sealed box', async () => {
  const id = await kitId('AQEAAAABc2VhbGVk')
  assert.match(id, /^K-[0-9A-F]{4}-[0-9A-F]{4}$/)
  assert.equal(await kitId('AQEAAAABc2VhbGVk'), id)
  assert.notEqual(await kitId('AQEAAAACc2VhbGVk'), id)
})
