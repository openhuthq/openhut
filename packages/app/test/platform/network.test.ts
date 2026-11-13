import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { guardedFetch } from '../../src/platform/network.ts'

test('guarded fetches refuse loopback, link-local and agent addresses, by name, by literal and after a redirect', async () => {
  for (const url of ['http://127.0.0.1:8999/', 'http://[::1]:8999/', 'http://localhost:8999/', 'http://169.254.169.254/latest', 'http://10.200.3.2/', 'http://[::ffff:127.0.0.1]:8999/']) {
    await assert.rejects(guardedFetch(url), (err: Error) => /Refused address/.test(String((err.cause as Error | undefined)?.message ?? err.message)), url)
  }
  const bounce = createServer((_req, res) => res.writeHead(302, { location: 'http://127.0.0.1:8999/' }).end()).listen(0, '0.0.0.0')
  await new Promise((resolve) => bounce.once('listening', resolve))
  const port = (bounce.address() as { port: number }).port
  const lan = Object.values((await import('node:os')).networkInterfaces()).flat().find((each) => each?.family === 'IPv4' && !each.internal)?.address
  try {
    if (lan) await assert.rejects(guardedFetch(`http://${lan}:${port}/`), (err: Error) => /Refused address/.test(String((err.cause as Error | undefined)?.message ?? err.message)))
  } finally {
    bounce.close()
  }
})
