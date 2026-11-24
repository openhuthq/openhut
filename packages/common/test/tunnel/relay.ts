import { createHash, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { generateKeyPair, serve, toHex, type ServeInput } from '../../src/tunnel/index.ts'

export const TOKEN = 'a-valid-access-token'

export type Relay = {
  url: string
  intercept: (frame: Buffer) => Buffer[]
  frames: Buffer[]
  kickComputer: () => void
  online: () => boolean
  registered: number
  refused: number
  pongs: number
  deaf: boolean
  close: () => Promise<void>
}

function bytes(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(new Uint8Array(data))
}

export async function startRelay(): Promise<Relay> {
  const server = new WebSocketServer({
    host: '127.0.0.1', port: 0, maxPayload: 1024 * 1024,
    handleProtocols: protocols => protocols.has('openhut') ? 'openhut' : false,
    verifyClient: ({ req }, done) => {
      const offered = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(each => each.trim())
      const valid = (req.headers['x-openhut-token'] ?? (offered[0] === 'openhut' ? offered[1] : undefined)) === TOKEN
      if (!valid) relay.refused++
      done(valid, 401)
    }
  })
  await once(server, 'listening')
  const devices = new Map<string, WebSocket>()
  let computer: WebSocket | undefined
  let lastSeen = 0
  const relay: Relay = {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    intercept: frame => [frame],
    frames: [],
    kickComputer: () => computer?.close(1012, 'restart'),
    online: () => computer !== undefined,
    registered: 0,
    refused: 0,
    pongs: 0,
    deaf: false,
    close: async () => {
      for (const client of server.clients) client.terminate()
      server.close()
      await once(server, 'close')
    }
  }
  server.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://relay')
    if (url.searchParams.get('role') === 'computer') {
      relay.registered++
      computer?.close(1000, 'replaced')
      computer = socket
      socket.on('message', (data, binary) => {
        const message = bytes(data)
        if (binary) return devices.get(message.subarray(0, 16).toString('hex'))?.send(message.subarray(16))
        if (message.toString() === 'ping') {
          if (relay.deaf) return
          relay.pongs++
          return socket.send('pong')
        }
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

export async function startComputer(options: Partial<Pick<ServeInput, 'handle' | 'keepalive' | 'socket' | 'token'>> = {}) {
  const relay = await startRelay()
  const key = generateKeyPair()
  const listed = new Set<string>()
  const handled: string[] = []
  const sockets: string[] = []
  const computerId = createHash('sha256').update(key.publicKey).digest('hex')
  const server = serve({
    relayUrl: relay.url,
    computerId,
    token: options.token ?? (async () => TOKEN),
    key,
    listed: device => listed.has(device),
    keepalive: options.keepalive,
    handle: async request => {
      handled.push(`${request.method} ${request.path}`)
      if (options.handle) return options.handle(request)
      return Response.json({ path: request.path, body: await new Response(request.body).text() })
    },
    socket: async request => {
      sockets.push(request.path)
      if (options.socket) return options.socket(request)
      return { send: request.send, close: () => sockets.push(`closed ${request.path}`) }
    }
  })
  if (!options.token) await waitFor(relay.online)
  return {
    relay,
    key,
    listed,
    handled,
    sockets,
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
