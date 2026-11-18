import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const SRC = new URL('../src/', import.meta.url)
const SEAM = 'lib/openhut.ts'

test('every request to a computer goes through openhut.fetch: only the transport in lib/openhut.ts calls fetch itself', () => {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && file !== SEAM)
  const found = files.filter((file) => /(?<![.\w])fetch\(|fetch\(\s*['"`]\/api/.test(readFileSync(new URL(file, SRC), 'utf8')))
  assert.deepEqual(found, [])
})
