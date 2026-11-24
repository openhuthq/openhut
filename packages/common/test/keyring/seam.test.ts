import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const ROOT = new URL('../../../../', import.meta.url)
const ROOTS = ['packages/runtime/src', 'packages/desktop/src', 'packages/desktop/scripts', 'packages/common/src', 'private/api/src', 'private/site/src']
const ALLOWED = ['packages/common/src/keyring/', 'packages/common/src/vault/secret.ts', 'packages/common/src/records/seal.ts']
const SECRET = /from '[^']*(vault\/secret|records\/seal)\.ts'/

function sources(root: string): string[] {
  if (!existsSync(new URL(root, ROOT))) return []
  return readdirSync(new URL(root, ROOT), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(ts|tsx|mjs|cjs)$/.test(file) && !file.includes('node_modules'))
    .map((file) => `${root}/${file}`)
}

test('only keyring/ imports vault/secret or record sealing: nobody else touches a raw key or a cipher', () => {
  const found = ROOTS.flatMap(sources).filter((file) => !ALLOWED.some((allowed) => file.startsWith(allowed)) && SECRET.test(readFileSync(new URL(file, ROOT), 'utf8')))
  assert.deepEqual(found, [])
})

test('outside keyring/, code reaches the keyring only through keyring.ts, its one interface', () => {
  const found = ROOTS.flatMap(sources).filter((file) => !file.startsWith('packages/common/src/keyring/') && /from '[^']*keyring\/(keys|rooms|store)\.ts'/.test(readFileSync(new URL(file, ROOT), 'utf8')))
  assert.deepEqual(found, [])
})
