import { connect, newWebKeyPair, toHex, webKey } from '../../src/index.ts'

const report = (path: string, body: unknown) => fetch(path, { method: 'POST', body: JSON.stringify(body) })

try {
  const key = await webKey(await newWebKeyPair())
  const { relayUrl, computer, token } = await (await report('/key', { key: toHex(key.publicKey) })).json() as { relayUrl: string; computer: { id: string; key: string }; token: string }
  const tunnel = await connect({ relayUrl, computer, key, token })
  const answer = await (await tunnel.fetch('/api/me')).json()
  tunnel.close()
  await report('/result', { answer })
} catch (error) {
  await report('/result', { error: String(error instanceof Error ? error.stack : error) })
}
