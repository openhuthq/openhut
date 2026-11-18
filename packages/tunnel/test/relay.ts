import { createHash, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { generateKeyPair, serve, toHex, type DeviceStatus, type Invited, type ServeInput } from '../src/index.ts'

export type Relay = {
  url: string
  intercept: (frame: Buffer) => Buffer[]
  frames: Buffer[]
  kickComputer: () => void
  online: () => boolean
  close: () => Promise<void>
}

function bytes(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(new Uint8Array(data))
}

export async function startRelay(): Promise<Relay> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 1024 * 1024 })
  await once(server, 'listening')
  const devices = new Map<string, WebSocket>()
  let tokenHash: string | undefined
  let computer: WebSocket | undefined
  let lastSeen = 0
  const relay: Relay = {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    intercept: frame => [frame],
    frames: [],
    kickComputer: () => computer?.close(1012, 'restart'),
    online: () => computer !== undefined,
    close: async () => {
      for (const client of server.clients) client.terminate()
      server.close()
      await once(server, 'close')
    }
  }
  server.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://relay')
    if (url.searchParams.get('role') === 'computer') {
      const hash = createHash('sha256').update(url.searchParams.get('token') ?? '').digest('hex')
      if (tokenHash && tokenHash !== hash) return socket.close(4001, 'token')
      tokenHash = hash
      computer?.close(1000, 'replaced')
      computer = socket
      socket.on('message', (data, binary) => {
        const message = bytes(data)
        if (binary) return devices.get(message.subarray(0, 16).toString('hex'))?.send(message.subarray(16))
        const parsed: { type?: string; session?: string } = JSON.parse(message.toString())
        if (parsed.type === 'close' && parsed.session) devices.get(parsed.session)?.close(4003, 'closed')
      })
      socket.on('close', () => {
        if (computer !== socket) return
        computer = undefined
        lastSeen = Date.now()
        for (const device of devices.values()) device.close(4004, `offline ${lastSeen}`)
      })
      return
    }
    if (!computer) return socket.close(4004, `offline ${lastSeen}`)
    if (devices.size >= 8) return socket.close(1013, 'busy')
    const session = randomBytes(16).toString('hex')
    devices.set(session, socket)
    computer.send(JSON.stringify({ type: 'open', session }))
    socket.on('message', (data, binary) => {
      if (!binary) return
      for (const frame of relay.intercept(bytes(data))) {
        relay.frames.push(frame)
        computer?.send(Buffer.concat([Buffer.from(session, 'hex'), frame]))
      }
    })
    socket.on('close', () => {
      devices.delete(session)
      computer?.send(JSON.stringify({ type: 'close', session }))
    })
  })
  return relay
}

export async function startComputer(options: Partial<Pick<ServeInput, 'handle' | 'invited'>> = {}) {
  const relay = await startRelay()
  const key = generateKeyPair()
  const statuses = new Map<string, DeviceStatus>()
  const handled: string[] = []
  const computerId = createHash('sha256').update(key.publicKey).digest('hex')
  const server = serve({
    relayUrl: relay.url,
    computerId,
    registerToken: 'token',
    key,
    device: device => statuses.get(device) ?? 'unknown',
    invited: options.invited ?? (async (): Promise<Invited | null> => null),
    handle: async request => {
      handled.push(`${request.method} ${request.path}`)
      if (options.handle) return options.handle(request)
      return Response.json({ path: request.path, body: await new Response(request.body).text() })
    }
  })
  await waitFor(relay.online)
  return {
    relay,
    key,
    statuses,
    handled,
    computer: { id: computerId, key: toHex(key.publicKey) },
    close: async () => {
      server.close()
      await relay.close()
    }
  }
}

export async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('The condition never held.')
}

export function newDevice() {
  const key = generateKeyPair()
  return { key, hex: toHex(key.publicKey) }
}

export function nativeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const agreed: string[] = []
  const agree = async (remote: Uint8Array) => {
    agreed.push(toHex(remote))
    const remoteKey = createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(remote).toString('base64url') }, format: 'jwk' })
    return new Uint8Array(diffieHellman({ privateKey, publicKey: remoteKey }))
  }
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x ?? '', 'base64url')
  return { key: { publicKey: new Uint8Array(raw), agree }, agreed, hex: raw.toString('hex') }
}
