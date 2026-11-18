import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Computer } from '@openhut/client'
import { adminsOf } from '../../../src/features/computers/admins.ts'

const computer = (id: string, online = true): Computer => ({ id, name: id, url: '', online, features: { whatsapp: false, browser: false }, appTooOld: false })

test('one computer that fails or never answers leaves the others\' admin in place', async () => {
  const reads: Record<string, () => Promise<string | undefined>> = {
    local: async () => 'local admin',
    broken: async () => { throw new Error('502') },
    stuck: () => new Promise(() => undefined),
    asleep: async () => 'never read',
  }
  const rows = await adminsOf({ computers: [computer('local'), computer('broken'), computer('stuck'), computer('asleep', false)], read: (id) => reads[id](), timeoutMs: 50 })
  assert.deepEqual(rows.map((row) => [row.computer.id, row.admin]), [['local', 'local admin'], ['broken', undefined], ['stuck', undefined], ['asleep', undefined]])
})
