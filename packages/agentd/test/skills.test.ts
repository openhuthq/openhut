import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { listSkills, readSkill, writeSkill } from '../src/skills.ts'

const skip = process.platform !== 'linux' && 'needs /proc (Linux)'
const base = realpathSync(mkdtempSync(`${tmpdir()}/skills-`))
const root = `${base}/skills`
const secret = `${base}/secret`
mkdirSync(`${root}/research/arxiv`, { recursive: true })
mkdirSync(`${root}/invoices`, { recursive: true })
mkdirSync(`${secret}/keys`, { recursive: true })
writeFileSync(`${root}/research/arxiv/SKILL.md`, '---\nname: arxiv\n---\nSearch papers.\n')
writeFileSync(`${root}/invoices/SKILL.md`, '---\nname: invoices\n---\nChase late invoices.\n')
writeFileSync(`${root}/.bundled_manifest`, 'arxiv:abc\n')
writeFileSync(`${secret}/keys/SKILL.md`, 'TOP SECRET')

test('lists skills at any depth with their first lines and the bundled manifest', { skip }, () => {
  const { skills, bundled } = listSkills(root)
  assert.deepEqual(skills.map((skill) => skill.path), ['invoices', 'research/arxiv'])
  assert.match(skills[0].head, /name: invoices/)
  assert.equal(bundled, 'arxiv:abc\n')
})

test('reads and rewrites a skill in place', { skip }, () => {
  writeSkill({ root, path: 'invoices', body: 'New body\n' })
  assert.equal(readSkill({ root, path: 'invoices' }), 'New body\n')
})

test('a symlinked file, a symlinked folder and a hard link are never read or written', { skip }, () => {
  mkdirSync(`${root}/linkfile`)
  symlinkSync(`${secret}/keys/SKILL.md`, `${root}/linkfile/SKILL.md`)
  symlinkSync(`${secret}/keys`, `${root}/linkdir`)
  mkdirSync(`${root}/hard`)
  linkSync(`${secret}/keys/SKILL.md`, `${root}/hard/SKILL.md`)
  for (const path of ['linkfile', 'linkdir', 'hard']) {
    assert.throws(() => readSkill({ root, path }), /gone/)
    assert.throws(() => writeSkill({ root, path, body: 'pwned' }), /gone/)
  }
  assert.deepEqual(listSkills(root).skills.map((skill) => skill.path), ['invoices', 'research/arxiv'])
  assert.equal(readFileSync(`${secret}/keys/SKILL.md`, 'utf8'), 'TOP SECRET')
})

test('a skills folder swapped for a symlink shows nothing from where it points', { skip }, () => {
  renameSync(root, `${base}/skills-real`)
  symlinkSync(secret, root)
  assert.deepEqual(listSkills(root).skills, [])
  assert.throws(() => readSkill({ root, path: 'keys' }), /gone/)
  assert.throws(() => writeSkill({ root, path: 'keys', body: 'pwned' }), /gone/)
  assert.equal(readFileSync(`${secret}/keys/SKILL.md`, 'utf8'), 'TOP SECRET')
})
