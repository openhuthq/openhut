import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../../../../..')

test('the openhut-ui plugin stamps the chat on every gateway tool that asks the owner', () => {
  const gateway = readFileSync(join('packages/runtime/src/server/gateway/gateway-server.ts'), 'utf8')
  const plugin = readFileSync(join('vendor/hermes-plugins/openhut-ui/__init__.py'), 'utf8')
  const asks = [...gateway.matchAll(/ask\(\{\s*name: '([a-z_]+)'/g)].map((m) => m[1])
  const stamped = /^STAMPED = \(([^)]*)\)/m.exec(plugin)?.[1] ?? ''
  assert.ok(asks.length >= 8)
  for (const name of [...asks, 'schedule_routine', 'call_tool']) assert.ok(stamped.includes(`"${name}"`), `${name} isn't stamped with its chat`)
})

function join(path: string): string {
  return resolve(ROOT, path)
}
