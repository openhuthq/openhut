import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { connect, fromHex, generateKeyPair, toHex, type TunnelError } from '@openhut/tunnel'
import { canonical, type Access, type Unsigned } from '@openhut/common/access/access.ts'

const sh = promisify(execFile)
const KEYS = `${process.env.RESULTS ?? '/results'}/tailnet-keys.json`
const URL = 'ws://127.0.0.1:8788'
const COMPUTER = process.env.OPENHUT_COMPUTER_KEY ?? ''
const PUT_ACCESS = `c=$(curl -sS -o /dev/null -w %{http_code} --unix-socket /data/app/openhut.sock -X PUT -H content-type:application/json --data-binary @- http://openhut/api/access); [ "$c" = 200 ] || [ "$c" = 409 ]`
const phase = process.argv[2]

type Saved = { device: { publicKey: string; secretKey: string } }

function env(): string {
  return readFileSync('/etc/openhut/env', 'utf8')
}

async function admin(device: { publicKey: Uint8Array; secretKey: Uint8Array }) {
  const tunnel = await connect({ relayUrl: '', url: URL, computer: { id: '', key: COMPUTER }, key: device, timeout: 10_000 })
  try {
    const reply = await tunnel.fetch('/api/admin')
    return { status: reply.status, json: await reply.json() as { relay: { key: string } } }
  } finally {
    tunnel.close()
  }
}

function put(list: Access): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile('sh', ['-c', PUT_ACCESS], (error) => error ? reject(error) : resolve(undefined))
    child.stdin?.end(JSON.stringify(list))
  })
}

if (phase === 'pair') {
  test('the install wrote the tailnet route and no join code', () => {
    assert.match(env(), /^OPENHUT_ROUTE=tailnet$/m)
    assert.match(env(), /^OPENHUT_TAILNET_PORT=8788$/m)
    assert.match(env(), /^OPENHUT_TAILNET_PORT=\d+$/m)
    assert.doesNotMatch(env(), /OPENHUT_JOIN/)
    assert.match(COMPUTER, /^[0-9a-f]{64}$/)
  })

  test('before the app pairs, the tailnet port turns every key away', async () => {
    await assert.rejects(admin(generateKeyPair()), (error: TunnelError) => error.type === 'closed')
  })

  test('the app pairs through the local socket, then reaches the runtime straight over the tailnet port', async () => {
    const owner = generateKeyPairSync('ed25519')
    const ownerKey = Buffer.from(owner.publicKey.export({ format: 'jwk' }).x ?? '', 'base64url').toString('hex')
    const device = generateKeyPair()
    const unsigned: Unsigned = { object: 'access', owner: ownerKey, version: 1, clients: [{ key: toHex(device.publicKey), name: 'Mac', addedAt: new Date().toISOString() }], computers: [] }
    await put({ ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), owner.privateKey).toString('hex') })
    await put({ ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), owner.privateKey).toString('hex') })
    const reply = await admin(device)
    assert.equal(reply.status, 200)
    assert.equal(reply.json.relay.key, COMPUTER)
    writeFileSync(KEYS, JSON.stringify({ device: { publicKey: toHex(device.publicKey), secretKey: toHex(device.secretKey) } } satisfies Saved))
  })

  test('a stranger on the tailnet still can\'t get in after pairing', async () => {
    await assert.rejects(admin(generateKeyPair()), (error: TunnelError) => error.type === 'closed')
  })
}

if (phase === 'after-upgrade') {
  test('an upgrade with no settings keeps the tailnet route, and the paired Mac still gets in', async () => {
    assert.match(env(), /^OPENHUT_ROUTE=tailnet$/m)
    assert.match(env(), /^OPENHUT_TAILNET_PORT=\d+$/m)
    const saved: Saved = JSON.parse(readFileSync(KEYS, 'utf8'))
    const reply = await admin({ publicKey: fromHex(saved.device.publicKey), secretKey: fromHex(saved.device.secretKey) })
    assert.equal(reply.status, 200)
  })
}

test('the runtime listens on the tailnet port', async () => {
  const { stdout } = await sh('sh', ['-c', 'grep -h relay.tailnet /var/log/openhut/app.log || true'])
  assert.match(stdout, /relay\.tailnet_listening/)
})
