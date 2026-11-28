import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Socket } from 'node:net'
import { duplexPair, type Duplex } from 'node:stream'
import { once } from 'node:events'
import { setTimeout as wait } from 'node:timers/promises'
import { config } from '../../../src/server/platform/config.ts'
import { forward, MAX_GATEWAY_STREAMS } from '../../../src/server/relay/forward.ts'

const held = new Set<Socket>()
const server = createServer((socket) => {
  held.add(socket)
  socket.on('close', () => held.delete(socket))
})
server.listen(config.gatewayPort, '127.0.0.1')
await once(server, 'listening')

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await wait(10)
  assert.ok(ok())
}
const open = (): { link: Duplex; runtime: Duplex } => {
  const [link, runtime] = duplexPair()
  forward.gateway({ computer: 'cm_capped', stream: link })
  return { link, runtime }
}

test('a full gateway refuses new streams, and frees its slots once they close', async () => {
  const streams = Array.from({ length: MAX_GATEWAY_STREAMS }, open)
  await until(() => held.size === MAX_GATEWAY_STREAMS)
  assert.equal(forward.gatewayFull('cm_capped'), true)
  const refused = open()
  assert.equal(refused.link.destroyed, true)
  for (const { link } of streams) link.destroy()
  await until(() => held.size === 0 && !forward.gatewayFull('cm_capped'))
  const next = open()
  assert.equal(next.link.destroyed, false)
  await until(() => held.size === 1)
  next.link.destroy()
  await until(() => held.size === 0)
})

test('a gateway socket that closes cleanly ends its link stream too', async () => {
  const { link } = open()
  await until(() => held.size === 1)
  for (const socket of held) socket.end()
  await until(() => link.destroyed)
  assert.equal(forward.gatewayFull('cm_capped'), false)
  server.close()
})
