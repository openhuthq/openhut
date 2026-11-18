import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isHomePath, isUploadName, MAX_FILE_BYTES, readHomeFile, saveUpload } from '../../src/agentd/files.ts'

const base = realpathSync(mkdtempSync(`${tmpdir()}/files-`))
const home = `${base}/agent/home`
const elsewhere = `${base}/other-agent`
mkdirSync(home, { recursive: true })
mkdirSync(elsewhere)
writeFileSync(`${elsewhere}/secret`, 'TOP SECRET')

test('an upload lands in uploads/ under its own name, and a second one with that name gets a number', () => {
  assert.equal(saveUpload({ home, name: 'notes.txt', body: Buffer.from('one') }), 'uploads/notes.txt')
  assert.equal(saveUpload({ home, name: 'notes.txt', body: Buffer.from('two') }), 'uploads/notes-2.txt')
  assert.equal(readFileSync(`${home}/uploads/notes.txt`, 'utf8'), 'one')
  assert.equal(readFileSync(`${home}/uploads/notes-2.txt`, 'utf8'), 'two')
})

test('an uploads folder or home the agent swapped for a symlink is never written through', () => {
  rmSync(`${home}/uploads`, { recursive: true })
  symlinkSync(elsewhere, `${home}/uploads`)
  assert.throws(() => saveUpload({ home, name: 'x.txt', body: Buffer.from('pwned') }))
  rmSync(`${home}/uploads`)
  rmSync(home, { recursive: true })
  symlinkSync(elsewhere, home)
  assert.throws(() => saveUpload({ home, name: 'x.txt', body: Buffer.from('pwned') }))
  assert.deepEqual(readdirSync(elsewhere), ['secret'])
  rmSync(home)
  mkdirSync(home)
})

test('a file in the home reads back as bytes; a symlink, a hard link or a missing file does not', () => {
  writeFileSync(`${home}/report.csv`, 'a,b\n')
  assert.equal(readHomeFile({ home, path: 'report.csv' }).toString(), 'a,b\n')
  symlinkSync(`${elsewhere}/secret`, `${home}/link.txt`)
  assert.throws(() => readHomeFile({ home, path: 'link.txt' }), /isn't in the agent's home/)
  linkSync(`${elsewhere}/secret`, `${home}/hard.txt`)
  assert.throws(() => readHomeFile({ home, path: 'hard.txt' }), /isn't in the agent's home/)
  symlinkSync(elsewhere, `${home}/dir`)
  assert.throws(() => readHomeFile({ home, path: 'dir/secret' }), /isn't in the agent's home/)
  assert.throws(() => readHomeFile({ home, path: 'missing.txt' }), /isn't in the agent's home/)
})

test('a file over the size limit is not read', () => {
  writeFileSync(`${home}/big.bin`, Buffer.alloc(MAX_FILE_BYTES + 1))
  assert.throws(() => readHomeFile({ home, path: 'big.bin' }), /over 25 MB/)
})

test('upload names and home paths that could leave the folder are refused', () => {
  assert.equal(isUploadName('Q3 report (final).pdf'), true)
  assert.equal(isUploadName('Résumé.pdf'), true)
  for (const name of ['', '.env', '..', '../x', 'a/b', '-rf', ' x', 'a\0b', 'x'.repeat(121)]) assert.equal(isUploadName(name), false, name)
  assert.equal(isHomePath('uploads/notes.txt'), true)
  for (const path of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'a/\0']) assert.equal(isHomePath(path), false, path)
})
