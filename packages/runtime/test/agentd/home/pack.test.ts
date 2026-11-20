import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { packHome, unpackHome } from '../../../src/agentd/home/pack.ts'

test('an agent\'s home packs and unpacks whole, and a broken pack is refused', async () => {
  const from = mkdtempSync(`${tmpdir()}/home-from-`)
  const to = mkdtempSync(`${tmpdir()}/home-to-`)
  mkdirSync(`${from}/skills/late-invoices`, { recursive: true })
  mkdirSync(`${from}/memories`)
  writeFileSync(`${from}/skills/late-invoices/SKILL.md`, '# Late invoices')
  writeFileSync(`${from}/memories/MEMORY.md`, 'Depot closes at 18:00')
  mkdirSync(`${from}/tools/python-3.14`, { recursive: true })
  writeFileSync(`${from}/tools/python-3.14/python.exe`, 'a Python Hermes downloaded for itself')
  mkdirSync(`${from}/skills/tools`, { recursive: true })
  writeFileSync(`${from}/skills/tools/SKILL.md`, '# Tools')
  await unpackHome({ dir: to, tar: await packHome(from) })
  assert.equal(readFileSync(`${to}/skills/late-invoices/SKILL.md`, 'utf8'), '# Late invoices')
  assert.equal(readFileSync(`${to}/memories/MEMORY.md`, 'utf8'), 'Depot closes at 18:00')
  assert.equal(existsSync(`${to}/._memories`), false)
  assert.equal(existsSync(`${to}/tools`), false)
  assert.equal(readFileSync(`${to}/skills/tools/SKILL.md`, 'utf8'), '# Tools')
  await assert.rejects(unpackHome({ dir: to, tar: Buffer.from('not a tar').toString('base64') }))
})

test('an unpacked home can be handed to the agent\'s user, links included', async () => {
  const from = mkdtempSync(`${tmpdir()}/home-from-`)
  const to = mkdtempSync(`${tmpdir()}/home-to-`)
  mkdirSync(`${from}/logs/curator`, { recursive: true })
  writeFileSync(`${from}/logs/curator/run.log`, 'ok')
  symlinkSync('/etc/passwd', `${from}/logs/link`)
  const owner = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }
  await unpackHome({ dir: to, tar: await packHome(from), owner })
  for (const path of ['', '/logs', '/logs/curator', '/logs/curator/run.log', '/logs/link']) assert.deepEqual([lstatSync(`${to}${path}`).uid, lstatSync(`${to}${path}`).gid], [owner.uid, owner.gid])
})
