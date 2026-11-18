import { test } from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
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

const SWAP = `import ctypes, os, sys, time
libc = ctypes.CDLL(None, use_errno=True)
os.chdir(sys.argv[1])
if sys.platform == 'darwin':
    swap = lambda: libc.renamex_np(b'uploads', b'uploads.swap', 2)
else:
    swap = lambda: libc.renameat2(-100, b'uploads', -100, b'uploads.swap', 2)
end = time.time() + 8
while time.time() < end:
    swap()`
const python = spawnSync('python3', ['-c', 'import ctypes'], { stdio: 'ignore' }).status === 0

test('an agent atomically swapping its uploads folder for a symlink mid-upload gets nothing out, not even an empty file', { skip: !python && 'needs python3 for an atomic swap' }, async () => {
  const race = realpathSync(mkdtempSync(`${tmpdir()}/race-`))
  const raceHome = `${race}/agent/home`
  const outside = `${race}/outside`
  mkdirSync(`${raceHome}/uploads`, { recursive: true })
  mkdirSync(outside)
  symlinkSync(outside, `${raceHome}/uploads.swap`)
  const swapper = spawn('python3', ['-I', '-c', SWAP, raceHome], { stdio: 'ignore' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  let saved = 0
  let refused = 0
  for (const end = Date.now() + 5000; Date.now() < end && !readdirSync(outside).length;) {
    try {
      saveUpload({ home: raceHome, name: `upload-${saved + refused}.txt`, body: Buffer.from('owner bytes') })
      saved++
    } catch {
      refused++
    }
  }
  swapper.kill()
  assert.ok(saved > 0 && refused > 0, `saved ${saved}, refused ${refused}`)
  assert.deepEqual(readdirSync(outside), [])
})

test('a copy of a long multi-byte name stays within 255 bytes and keeps its extension', () => {
  const name = `${'報'.repeat(83)}.pdf`
  assert.equal(isUploadName(name), true)
  saveUpload({ home, name, body: Buffer.from('one') })
  const copy = saveUpload({ home, name, body: Buffer.from('two') }).slice('uploads/'.length)
  assert.ok(Buffer.byteLength(copy) <= 255)
  assert.ok(copy.endsWith('-2.pdf'))
  assert.equal(isUploadName(`${'報'.repeat(86)}.pdf`), false)
})

test('a file in the home reads back as bytes; a symlink, a hard link or a missing file does not', () => {
  writeFileSync(`${home}/report.csv`, 'a,b\n')
  assert.equal(readHomeFile({ home, path: 'report.csv' })?.toString(), 'a,b\n')
  symlinkSync(`${elsewhere}/secret`, `${home}/link.txt`)
  assert.equal(readHomeFile({ home, path: 'link.txt' }), undefined)
  linkSync(`${elsewhere}/secret`, `${home}/hard.txt`)
  assert.equal(readHomeFile({ home, path: 'hard.txt' }), undefined)
  symlinkSync(elsewhere, `${home}/dir`)
  assert.equal(readHomeFile({ home, path: 'dir/secret' }), undefined)
  assert.equal(readHomeFile({ home, path: 'missing.txt' }), undefined)
})

test('a file over the size limit is not read', () => {
  writeFileSync(`${home}/big.bin`, Buffer.alloc(MAX_FILE_BYTES + 1))
  assert.throws(() => readHomeFile({ home, path: 'big.bin' }), /over 25 MB/)
})

test('upload names and home paths that could leave the folder are refused', () => {
  assert.equal(isUploadName('Q3 report (final).pdf'), true)
  assert.equal(isUploadName('Résumé.pdf'), true)
  for (const name of ['', '.env', '..', '../x', 'a/b', '-rf', ' x', ')x.txt', 'a\0b', 'x'.repeat(121)]) assert.equal(isUploadName(name), false, name)
  assert.equal(isHomePath('uploads/notes.txt'), true)
  for (const path of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'a/\0']) assert.equal(isHomePath(path), false, path)
})
