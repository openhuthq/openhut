import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FACES, faceName } from '@openhut/common/cloud/cloud.ts'
import { faceArt, faceLook, parseLook, randomLook, SWATCHES } from '../../src/lib/face.ts'

test('a saved look in the old shape reads as the seeded look it always was', () => {
  assert.deepEqual(parseLook({ id: 'face_7_1', about: 'ops beanie' }), randomLook({ seed: 'face_7_1', about: 'ops beanie' }))
  assert.equal(randomLook({ seed: 'face_7_1', about: 'ops beanie' }).hat, 'beanie')
})

test('a saved full look round-trips and bad fields fall back', () => {
  const look = { ...randomLook({ seed: 'a' }), hair: 'swept' as const, hairColor: 13, eyewear: 'specs' as const, bg: 'periwinkle' }
  assert.deepEqual(parseLook(JSON.parse(JSON.stringify(look))), look)
  const bent = parseLook({ ...look, body: 99, hair: 'afro', bg: 'plaid', eyes: -1 })
  assert.equal(bent?.hair, null)
  assert.equal(bent?.bg, null)
  assert.equal(bent?.body, randomLook({ seed: 'a' }).body)
  assert.equal(parseLook('nope'), null)
})

test('the background shows only when asked for', () => {
  const look = { ...randomLook({ seed: 'a' }), bg: 'yellow' }
  assert.ok(!faceArt({ look }).includes('<rect x="4"'))
  assert.ok(faceArt({ look, tile: true }).startsWith('<rect x="4"'))
})

test('each approval face has a name that says its colour and what it wears, so a server can print it', () => {
  const words = { tophat: 'top hat', party: 'party hat' } as Record<string, string>
  for (let index = 0; index < FACES; index++) {
    const look = faceLook(index)
    const worn = look.hat ?? look.eyewear ?? ''
    assert.ok(faceName(index).startsWith(`${SWATCHES[look.body].name} face with `), faceName(index))
    assert.ok(faceName(index).endsWith(words[worn] ?? worn), faceName(index))
  }
  assert.equal(new Set(Array.from({ length: FACES }, (_, index) => faceName(index))).size, FACES)
})
