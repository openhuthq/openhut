import { test } from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isHomePath, isUploadName, MAX_FILE_BYTES, readHomeFile, removeUploads, saveUpload, statHomeFiles } from '../../src/agentd/files.ts'

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
a, b = sys.argv[2].encode(), sys.argv[3].encode()
if sys.platform == 'darwin':
    swap = lambda: libc.renamex_np(a, b, 2)
else:
    swap = lambda: libc.renameat2(-100, a, -100, b, 2)
end = time.time() + 8
while time.time() < end:
    swap()`
const python = spawnSync('python3', ['-c', 'import ctypes'], { stdio: 'ignore' }).status === 0
const RACES = {
  'its uploads folder for a symlink': ({ home, outside }: { home: string; outside: string }) => {
    symlinkSync(`${outside}/uploads`, `${home}/uploads.swap`)
    return [home, 'uploads', 'uploads.swap']
  },
  'its home for a symlink': ({ home, outside }: { home: string; outside: string }) => {
    symlinkSync(outside, `${home}.swap`)
    return [`${home}/..`, 'home', 'home.swap']
  },
  'its home for a real folder whose uploads is a symlink': ({ home, outside }: { home: string; outside: string }) => {
    mkdirSync(`${home}.swap`)
    symlinkSync(`${outside}/uploads`, `${home}.swap/uploads`)
    return [`${home}/..`, 'home', 'home.swap']
  },
}

for (const [race, arrange] of Object.entries(RACES)) {
  test(`an agent atomically swapping ${race} mid-upload gets nothing out, and agentd's own folder never moves`, { skip: !python && 'needs python3 for an atomic swap' }, async () => {
    const base = realpathSync(mkdtempSync(`${tmpdir()}/race-`))
    const raceHome = `${base}/agent/home`
    const outside = `${base}/outside`
    mkdirSync(`${raceHome}/uploads`, { recursive: true })
    mkdirSync(`${outside}/uploads`, { recursive: true })
    const swapper = spawn('python3', ['-I', '-c', SWAP, ...arrange({ home: raceHome, outside })], { stdio: 'ignore' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const cwd = process.cwd()
    let saved = 0
    let refused = 0
    for (const end = Date.now() + 4000; Date.now() < end && !readdirSync(`${outside}/uploads`).length;) {
      try {
        saveUpload({ home: raceHome, name: `upload-${saved + refused}.txt`, body: Buffer.from('owner bytes') })
        saved++
      } catch {
        refused++
      }
      assert.equal(process.cwd(), cwd)
    }
    swapper.kill()
    assert.ok(saved > 0 && refused > 0, `saved ${saved}, refused ${refused}`)
    assert.deepEqual(readdirSync(`${outside}/uploads`), [])
    assert.deepEqual(readdirSync(outside), ['uploads'])
  })
}

for (const [race, arrange] of Object.entries(RACES)) {
  test(`an agent atomically swapping ${race} while its uploads are deleted never gets a file outside deleted`, { skip: !python && 'needs python3 for an atomic swap' }, async () => {
    const base = realpathSync(mkdtempSync(`${tmpdir()}/race-rm-`))
    const raceHome = `${base}/agent/home`
    const outside = `${base}/outside`
    mkdirSync(`${raceHome}/uploads`, { recursive: true })
    mkdirSync(`${outside}/uploads`, { recursive: true })
    const names = Array.from({ length: 20 }, (_, index) => `victim-${index}.txt`)
    for (const name of names) writeFileSync(`${outside}/uploads/${name}`, 'not yours')
    const swapper = spawn('python3', ['-I', '-c', SWAP, ...arrange({ home: raceHome, outside })], { stdio: 'ignore' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const cwd = process.cwd()
    let rounds = 0
    for (const end = Date.now() + 3000; Date.now() < end; rounds++) {
      for (const name of names) {
        try {
          writeFileSync(`${raceHome}/uploads/${name}`, 'mine')
        } catch {}
      }
      try {
        removeUploads({ home: raceHome, names })
      } catch {}
      assert.equal(process.cwd(), cwd)
    }
    swapper.kill()
    assert.ok(rounds > 10)
    assert.deepEqual(readdirSync(`${outside}/uploads`).sort(), [...names].sort())
  })
}

test('deleting uploads removes only plain files in uploads/, and nothing when uploads or home is a symlink', () => {
  const base = realpathSync(mkdtempSync(`${tmpdir()}/rm-`))
  const rmHome = `${base}/agent/home`
  const away = `${base}/away`
  mkdirSync(`${rmHome}/uploads/folder.txt`, { recursive: true })
  mkdirSync(away)
  writeFileSync(`${rmHome}/uploads/a.txt`, 'a')
  writeFileSync(`${rmHome}/uploads/b.txt`, 'b')
  writeFileSync(`${away}/c.txt`, 'c')
  symlinkSync(`${away}/c.txt`, `${rmHome}/uploads/c.txt`)
  assert.deepEqual(removeUploads({ home: rmHome, names: ['a.txt', 'missing.txt', 'folder.txt'] }), ['a.txt'])
  assert.deepEqual(readdirSync(`${rmHome}/uploads`).sort(), ['b.txt', 'c.txt', 'folder.txt'])
  assert.deepEqual(removeUploads({ home: rmHome, names: ['c.txt'] }), [])
  assert.equal(readFileSync(`${away}/c.txt`, 'utf8'), 'c')
  writeFileSync(`${away}/b.txt`, 'b')
  rmSync(`${rmHome}/uploads`, { recursive: true })
  symlinkSync(away, `${rmHome}/uploads`)
  assert.throws(() => removeUploads({ home: rmHome, names: ['b.txt'] }))
  assert.equal(readFileSync(`${away}/b.txt`, 'utf8'), 'b')
  rmSync(`${rmHome}/uploads`)
  assert.deepEqual(removeUploads({ home: rmHome, names: ['b.txt'] }), [])
})

test('looking files up reports the plain files that exist with their sizes, and nothing behind a symlink', () => {
  const base = realpathSync(mkdtempSync(`${tmpdir()}/stat-`))
  const statHome = `${base}/home`
  mkdirSync(statHome)
  writeFileSync(`${statHome}/report.csv`, 'a,b\n')
  writeFileSync(`${base}/secret`, 'x')
  symlinkSync(`${base}/secret`, `${statHome}/link.txt`)
  assert.deepEqual(statHomeFiles({ home: statHome, paths: ['report.csv', 'link.txt', 'missing.txt'] }), [{ path: 'report.csv', size: 4 }])
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
  for (const name of ['', '.env', '..', '../x', 'a/b', '-rf', ' x', ')x.txt', 'a\0b', 'x'.repeat(129)]) assert.equal(isUploadName(name), false, name)
  assert.equal(isHomePath('uploads/notes.txt'), true)
  for (const path of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'a/\0']) assert.equal(isHomePath(path), false, path)
})
