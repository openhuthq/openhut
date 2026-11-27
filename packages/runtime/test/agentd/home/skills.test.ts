import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { listSkills, openInside, readInside } from '../../../src/agentd/home/skills.ts'

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

const opens = (path: string) => readInside({ root, file: `${path}/SKILL.md`, limit: 100 }) !== undefined || openInside({ root, file: `${path}/SKILL.md`, flags: constants.O_WRONLY }) !== undefined

test('a symlinked file, a symlinked folder and a hard link are never read or written', { skip }, () => {
  mkdirSync(`${root}/linkfile`)
  symlinkSync(`${secret}/keys/SKILL.md`, `${root}/linkfile/SKILL.md`)
  symlinkSync(`${secret}/keys`, `${root}/linkdir`)
  mkdirSync(`${root}/hard`)
  linkSync(`${secret}/keys/SKILL.md`, `${root}/hard/SKILL.md`)
  for (const path of ['linkfile', 'linkdir', 'hard']) {
    assert.equal(opens(path), false)
  }
  assert.deepEqual(listSkills(root).skills.map((skill) => skill.path), ['invoices', 'research/arxiv'])
  assert.equal(readFileSync(`${secret}/keys/SKILL.md`, 'utf8'), 'TOP SECRET')
})

test('a skills folder swapped for a symlink shows nothing from where it points', { skip }, () => {
  renameSync(root, `${base}/skills-real`)
  symlinkSync(secret, root)
  assert.deepEqual(listSkills(root).skills, [])
  assert.equal(opens('keys'), false)
  assert.equal(readFileSync(`${secret}/keys/SKILL.md`, 'utf8'), 'TOP SECRET')
})
