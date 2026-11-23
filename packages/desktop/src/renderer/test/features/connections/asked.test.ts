import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askPath } from '@openhut/common/asks/ask.ts'
import { askOf } from '../../../src/features/connections/asked.ts'

test('askOf reads back what askPath put in the link', () => {
  const path = askPath({ agentId: 'ag_1', app: 'mcp', url: 'https://observability.mcp.cloudflare.com/mcp', name: 'Cloudflare', auth: 'sign_in' })
  assert.deepEqual(askOf(path.slice(path.indexOf('?'))), { agentId: 'ag_1', url: 'https://observability.mcp.cloudflare.com/mcp', name: 'Cloudflare', auth: 'sign_in' })
  assert.deepEqual(askOf(''), { agentId: undefined, url: undefined, name: undefined, auth: undefined })
})
