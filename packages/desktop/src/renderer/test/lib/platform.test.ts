import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { wordsFor } from '../../src/lib/platform.ts'

test('the app calls a Mac a Mac and anything else this computer', () => {
  assert.equal(wordsFor('darwin').thisComputer, 'This Mac')
  assert.equal(wordsFor('darwin').keychain, 'macOS Keychain')
  assert.equal(wordsFor('linux').thisComputer, 'This computer')
  assert.equal(wordsFor('linux').here, 'computer')
  assert.equal(wordsFor('linux').showFolder, 'Open folder')
  assert.equal(wordsFor('linux').dockBadge, false)
})

test('no screen hardcodes Mac words outside the platform helper', () => {
  const root = new URL('../../src/', import.meta.url)
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && file !== 'lib/platform.ts')
  const found = files.filter((file) => /this Mac|This Mac|macOS Keychain|Finder|the Dock/.test(readFileSync(new URL(file, root), 'utf8')))
  assert.deepEqual(found, [])
})
