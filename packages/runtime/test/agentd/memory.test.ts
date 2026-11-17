import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readMemory, writeMemory } from '../../src/agentd/memory.ts'

const skip = process.platform !== 'linux' && 'needs /proc (Linux)'
const base = realpathSync(mkdtempSync(`${tmpdir()}/memory-`))
const root = `${base}/memories`
mkdirSync(root)
writeFileSync(`${root}/MEMORY.md`, 'Late means 5 days.\n§\nRefunds need David.')
writeFileSync(`${base}/secret`, 'TOP SECRET')

test('reads both files; one the agent never saved is null', { skip }, () => {
  assert.deepEqual(readMemory(root), { notes: 'Late means 5 days.\n§\nRefunds need David.', people: null })
})

test('rewrites a saved file in place and never creates a missing one', { skip }, () => {
  writeMemory({ root, target: 'notes', body: 'Depot closes at 18:00' })
  assert.equal(readFileSync(`${root}/MEMORY.md`, 'utf8'), 'Depot closes at 18:00')
  assert.throws(() => writeMemory({ root, target: 'people', body: 'x' }), /not saved/)
})

test('a symlinked memory file is never read or written', { skip }, () => {
  symlinkSync(`${base}/secret`, `${root}/USER.md`)
  assert.equal(readMemory(root).people, null)
  assert.throws(() => writeMemory({ root, target: 'people', body: 'pwned' }), /not saved/)
  assert.equal(readFileSync(`${base}/secret`, 'utf8'), 'TOP SECRET')
})
