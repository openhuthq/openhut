import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const skip = process.platform !== 'linux' && 'needs /proc (Linux)'
const data = realpathSync(mkdtempSync(`${tmpdir()}/home-`))
process.env.AGENTD_DATA = data
process.env.OPENHUT_SANDBOX = 'memory'
const { agentHome } = await import('../../../src/agentd/home/home.ts')
const id = 'ag_hometest'
const root = `${data}/agents/${id}`
mkdirSync(`${root}/memories`, { recursive: true })
mkdirSync(`${root}/skills/invoices`, { recursive: true })
writeFileSync(`${root}/memories/MEMORY.md`, 'Late means 5 days.\n§\nRefunds need David.')
writeFileSync(`${root}/skills/invoices/SKILL.md`, '---\nname: invoices\n---\n')
writeFileSync(`${data}/secret`, 'TOP SECRET')

test('a path names one kind of thing in the home, and anything else is refused', () => {
  assert.equal(agentHome.kindOf('skills/research/arxiv/SKILL.md'), 'skill')
  assert.equal(agentHome.kindOf('skills/research/arxiv'), 'skill-folder')
  assert.equal(agentHome.kindOf('memories/USER.md'), 'memory')
  assert.equal(agentHome.kindOf('home/uploads/notes.txt'), 'upload')
  assert.equal(agentHome.kindOf('home/reports/q3.csv'), 'file')
  assert.equal(agentHome.kindOf('platforms/whatsapp/session'), 'session')
  for (const bad of ['config.yaml', '.env', 'memories/other.md', 'skills/.bundled_manifest', 'home/../config.yaml', 'home/', 'platforms/whatsapp', 'state.db', 42]) assert.equal(agentHome.kindOf(bad), undefined, String(bad))
})

test('memory: reads a saved file, rewrites it in place, never creates a missing one', { skip }, () => {
  assert.equal(agentHome.read({ id, path: 'memories/MEMORY.md' })?.toString(), 'Late means 5 days.\n§\nRefunds need David.')
  assert.equal(agentHome.read({ id, path: 'memories/USER.md' }), null)
  agentHome.write({ id, path: 'memories/MEMORY.md', body: Buffer.from('Depot closes at 18:00') })
  assert.equal(readFileSync(`${root}/memories/MEMORY.md`, 'utf8'), 'Depot closes at 18:00')
  assert.throws(() => agentHome.write({ id, path: 'memories/USER.md', body: Buffer.from('x') }), /not saved/)
})

test('a skill is rewritten in place, and an empty body is refused', { skip }, () => {
  agentHome.write({ id, path: 'skills/invoices/SKILL.md', body: Buffer.from('Chase late invoices.') })
  assert.equal(agentHome.read({ id, path: 'skills/invoices/SKILL.md' })?.toString(), 'Chase late invoices.')
  assert.throws(() => agentHome.write({ id, path: 'skills/invoices/SKILL.md', body: Buffer.alloc(0) }), /missing/)
  assert.throws(() => agentHome.write({ id, path: 'skills/gone/SKILL.md', body: Buffer.from('x') }), /gone/)
})

test('a symlinked memory file is never read or written', { skip }, () => {
  symlinkSync(`${data}/secret`, `${root}/memories/USER.md`)
  assert.equal(agentHome.read({ id, path: 'memories/USER.md' }), null)
  assert.throws(() => agentHome.write({ id, path: 'memories/USER.md', body: Buffer.from('pwned') }), /not saved/)
  assert.equal(readFileSync(`${data}/secret`, 'utf8'), 'TOP SECRET')
})
