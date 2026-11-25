import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const SRC = new URL('../src/', import.meta.url)
const SEAMS = ['lib/openhut.ts', 'lib/remote.ts', 'lib/config.ts']

test('every request goes to this computer\'s runtime through one seam: only lib/openhut.ts (and the phone update check, which asks the update host, the web app’s sign-in, which asks the cloud API, and /config.json) calls fetch itself', () => {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && !SEAMS.includes(file))
  const found = files.filter((file) => /(?<![.\w])fetch\(|fetch\(\s*['"`]\/api/.test(readFileSync(new URL(file, SRC), 'utf8')))
  assert.deepEqual(found, [])
})

test('the App reads End-to-end encryption in one place: only useEncryption() looks at cloud.encryption', () => {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && file !== 'features/settings/encryption.tsx')
  assert.deepEqual(files.filter((file) => /\.encryption\b|\bmanaged\b/.test(readFileSync(new URL(file, SRC), 'utf8'))), [])
})
