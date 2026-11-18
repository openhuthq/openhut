import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const SRC = new URL('../src/', import.meta.url)
const SEAMS = ['lib/openhut.ts', 'lib/updates.ts']

test('every request to a computer goes through openhut.fetch: only the transport in lib/openhut.ts (and the phone update check, which asks the update host) calls fetch itself', () => {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && !SEAMS.includes(file))
  const found = files.filter((file) => /(?<![.\w])fetch\(|fetch\(\s*['"`]\/api/.test(readFileSync(new URL(file, SRC), 'utf8')))
  assert.deepEqual(found, [])
})
