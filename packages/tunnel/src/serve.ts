import { FrameType, MAX_REQUEST_BODY, MAX_SOCKET_MESSAGE, REQUEST_HEADERS, chunks, decodeFrame, decodeJson, encodeFrame, encodeJson, isRecord, messageChunks, messageJoiner, stringRecord, type Frame, type SocketMessage } from './frames.ts'
import { fromHex, responder, toHex, type ComputerKey, type Transport } from './noise.ts'

export type DeviceStatus = 'client' | 'removed' | 'unknown'
export type Hello = { type: 'hello'; proof: string; name: string; kind: 'client' | 'computer'; computer?: { id: string; name: string } }
export type Decision = { type: 'accepted'; access: object } | { type: 'declined' }
export type Invited = { accept: () => AsyncIterable<Decision> }
export type TunnelRequest = { device: string; method: string; path: string; headers: Record<string, string>; body: ReadableStream<Uint8Array> }
export type SocketPeer = { send: (data: SocketMessage) => void; close: () => void }
export type TunnelSocketRequest = { device: string; path: string; headers: Record<string, string> } & Pick<SocketPeer, 'send'> & { close: (input: { code: number; reason: string }) => void }
export type ServeInput = {
  relayUrl: string
  computerId: string
  registerToken: string
  key: ComputerKey
  device: (key: string) => DeviceStatus
  invited: (input: { key: string; proof: string; handshakeHash: Uint8Array; hello: Hello }) => Promise<Invited | null>
  handle: (input: TunnelRequest) => Promise<Response>
  socket: (input: TunnelSocketRequest) => Promise<SocketPeer>
  keepalive?: { every: number; within: number }
}
type Socket = { peer: Promise<SocketPeer>; join: ReturnType<typeof messageJoiner> }
type Incoming = { method: string; path: string; headers: Record<string, string>; parts: Uint8Array<ArrayBuffer>[]; size: number }
type Session = {
  id: string
  key: string
  transport?: Transport
  first: boolean
  requests: Map<number, Incoming>
  sockets: Map<number, Socket>
  readers: Set<ReadableStreamDefaultReader<Uint8Array>>
}

const empty = new Uint8Array(0)
const NodeSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket

function envelope({ id, payload }: { id: string; payload: Uint8Array }): Uint8Array {
  const message = new Uint8Array(16 + payload.byteLength)
  message.set(fromHex(id))
  message.set(payload, 16)
  return message
}

function parseHello(value: Record<string, unknown>): Hello | null {
  const { type, proof, name, kind, computer } = value
  if (type !== 'hello' || typeof proof !== 'string' || typeof name !== 'string') return null
  if (kind !== 'client' && kind !== 'computer') return null
  if (computer === undefined) return { type, proof, name, kind }
  if (!isRecord(computer) || typeof computer.id !== 'string' || typeof computer.name !== 'string') return null
  return { type, proof, name, kind, computer: { id: computer.id, name: computer.name } }
}

function allowedHeaders(headers: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(stringRecord(headers)).filter(([name]) => REQUEST_HEADERS.includes(name)))
}

export function serve(input: ServeInput): { close: () => void } {
  const sessions = new Map<string, Session>()
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let stopped = false
  let lose = () => {}

  const live = (session: Session) => sessions.get(session.id) === session

  const drop = (id: string) => {
    const session = sessions.get(id)
    if (!session) return
    sessions.delete(id)
    for (const reader of session.readers) reader.cancel().catch(() => {})
    for (const { peer } of session.sockets.values()) peer.then(open => open.close(), () => {})
    session.sockets.clear()
  }

  const kill = (id: string) => {
    socket?.send(JSON.stringify({ type: 'close', session: id }))
    drop(id)
  }

  const send = (session: Session, frame: Frame) => {
    if (!live(session) || !session.transport) return
    socket?.send(new Uint8Array(envelope({ id: session.id, payload: session.transport.encrypt(encodeFrame(frame)) })))
  }

  const reply = ({ session, stream, status }: { session: Session; stream: number; status: number }) => {
    send(session, { type: FrameType.responseHead, stream, payload: encodeJson({ status, headers: {} }) })
    send(session, { type: FrameType.responseEnd, stream, payload: empty })
  }

  const fault = ({ session, stream, message }: { session: Session; stream: number; message: string }) =>
    send(session, { type: FrameType.responseError, stream, payload: encodeJson({ type: 'internal', message }) })

  const respond = async ({ session, stream, incoming }: { session: Session; stream: number; incoming: Incoming }) => {
    const { method, path, headers, parts } = incoming
    let response: Response
    try {
      response = await input.handle({ device: session.key, method, path, headers, body: new Blob(parts).stream() })
    } catch {
      return fault({ session, stream, message: 'The computer could not answer this request.' })
    }
    if (!live(session)) return response.body?.cancel()
    send(session, { type: FrameType.responseHead, stream, payload: encodeJson({ status: response.status, headers: Object.fromEntries(response.headers) }) })
    const reader = response.body?.getReader()
    if (reader) session.readers.add(reader)
    try {
      for (let part = await reader?.read(); part && !part.done; part = await reader?.read()) {
        for (const chunk of chunks(part.value)) send(session, { type: FrameType.responseBody, stream, payload: chunk })
      }
      send(session, { type: FrameType.responseEnd, stream, payload: empty })
    } catch {
      fault({ session, stream, message: 'The answer to this request broke off.' })
    } finally {
      if (reader) session.readers.delete(reader)
    }
  }

  const greet = async ({ session, hello }: { session: Session; hello: Hello | null }) => {
    if (!hello || !session.transport) return kill(session.id)
    try {
      const invitation = await input.invited({ key: session.key, proof: hello.proof, handshakeHash: session.transport.handshakeHash, hello })
      if (!invitation) return kill(session.id)
      for await (const decision of invitation.accept()) {
        if (!live(session)) return
        send(session, { type: FrameType.control, stream: 0, payload: encodeJson(decision) })
        if (decision.type === 'declined') return kill(session.id)
      }
    } catch {
      kill(session.id)
    }
  }

  const admitted = ({ session, removed }: { session: Session; removed: Frame }) => {
    const status = input.device(session.key)
    if (status === 'client') return true
    send(session, removed)
    kill(session.id)
    return false
  }

  const removedSocket = (stream: number): Frame => ({ type: FrameType.socketClose, stream, payload: encodeJson({ code: 4403, reason: 'This device was removed.' }) })

  const begin = ({ session, stream, payload }: { session: Session; stream: number; payload: Uint8Array }) => {
    if (!admitted({ session, removed: { type: FrameType.responseError, stream, payload: encodeJson({ type: 'removed', message: 'This device was removed.' }) } })) return
    const head = decodeJson(payload)
    if (session.requests.has(stream) || typeof head.method !== 'string' || typeof head.path !== 'string' || !head.path.startsWith('/')) return kill(session.id)
    session.requests.set(stream, { method: head.method, path: head.path, headers: allowedHeaders(head.headers), parts: [], size: 0 })
  }

  const shut = ({ session, stream, code, reason }: { session: Session; stream: number; code: number; reason: string }) => {
    const open = session.sockets.get(stream)
    if (!open) return
    session.sockets.delete(stream)
    send(session, { type: FrameType.socketClose, stream, payload: encodeJson({ code, reason }) })
    open.peer.then(peer => peer.close(), () => {})
  }

  const opening = ({ session, stream, payload }: { session: Session; stream: number; payload: Uint8Array }) => {
    if (!admitted({ session, removed: removedSocket(stream) })) return
    const head = decodeJson(payload)
    if (session.sockets.has(stream) || typeof head.path !== 'string' || !head.path.startsWith('/')) return kill(session.id)
    const toDevice = (data: SocketMessage) => {
      if (!session.sockets.has(stream) || !admitted({ session, removed: removedSocket(stream) })) return
      for (const chunk of messageChunks(data)) send(session, { type: FrameType.socketMessage, stream, payload: chunk })
    }
    const closed = ({ code, reason }: { code: number; reason: string }) => {
      if (!session.sockets.delete(stream)) return
      send(session, { type: FrameType.socketClose, stream, payload: encodeJson({ code, reason }) })
    }
    const peer = input.socket({ device: session.key, path: head.path, headers: allowedHeaders(head.headers), send: toDevice, close: closed })
    session.sockets.set(stream, { peer, join: messageJoiner() })
    peer.catch(() => closed({ code: 1011, reason: 'The computer could not open this socket.' }))
  }

  const fromDevice = ({ session, stream, type, payload }: Frame & { session: Session }) => {
    const open = session.sockets.get(stream)
    if (!open || !admitted({ session, removed: removedSocket(stream) })) return
    if (type === FrameType.socketClose) {
      session.sockets.delete(stream)
      return void open.peer.then(peer => peer.close(), () => {})
    }
    if (open.join.size() + payload.byteLength - 1 > MAX_SOCKET_MESSAGE) return shut({ session, stream, code: 1009, reason: 'That message is too big.' })
    const data = open.join.add(payload)
    if (data !== undefined) open.peer.then(peer => peer.send(data), () => {})
  }

  const receive = (session: Session, { type, stream, payload }: Frame) => {
    const first = session.first
    session.first = false
    if (type === FrameType.control && first) return void greet({ session, hello: parseHello(decodeJson(payload)) })
    if (type === FrameType.requestHead) return begin({ session, stream, payload })
    if (type === FrameType.socketOpen) return opening({ session, stream, payload })
    if (type === FrameType.socketMessage || type === FrameType.socketClose) return fromDevice({ session, stream, type, payload })
    const incoming = session.requests.get(stream)
    if (type === FrameType.requestBody && incoming) {
      incoming.size += payload.byteLength
      if (incoming.size <= MAX_REQUEST_BODY) return void incoming.parts.push(Uint8Array.from(payload))
      session.requests.delete(stream)
      return reply({ session, stream, status: 413 })
    }
    if (type === FrameType.requestEnd && incoming) {
      session.requests.delete(stream)
      return void respond({ session, stream, incoming })
    }
    if (type === FrameType.requestBody || type === FrameType.requestEnd) return
    kill(session.id)
  }

  const onBinary = (data: Uint8Array) => {
    if (data.byteLength < 16) return
    const id = toHex(data.subarray(0, 16))
    const session = sessions.get(id)
    if (!session) return
    const payload = data.subarray(16)
    try {
      if (session.transport) return receive(session, decodeFrame(session.transport.decrypt(payload)))
      const handshake = responder({ key: input.key })
      handshake.read(payload)
      const { message, transport } = handshake.write()
      session.transport = transport
      session.key = toHex(transport.remoteKey)
      socket?.send(new Uint8Array(envelope({ id, payload: message })))
    } catch {
      kill(id)
    }
  }

  const onText = (text: string) => {
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (!isRecord(message) || typeof message.session !== 'string' || !/^[0-9a-f]{32}$/.test(message.session)) return
    const id = message.session
    if (message.type === 'open') sessions.set(id, { id, key: '', first: true, requests: new Map(), sockets: new Map(), readers: new Set() })
    if (message.type === 'close') drop(id)
  }

  const open = () => {
    const { every, within } = input.keepalive ?? { every: 30_000, within: 75_000 }
    const current = new NodeSocket(`${input.relayUrl}/v1/relay/${input.computerId}?role=computer`, { headers: { 'x-openhut-token': input.registerToken } })
    current.binaryType = 'arraybuffer'
    socket = current
    let ping: ReturnType<typeof setInterval> | undefined
    const lost = () => {
      if (socket !== current) return
      socket = undefined
      clearInterval(ping)
      clearTimeout(deadline)
      current.close()
      for (const id of [...sessions.keys()]) drop(id)
      if (!stopped) timer = setTimeout(open, Math.min(30_000, 250 * 2 ** attempts++))
    }
    let deadline = setTimeout(lost, within)
    lose = lost
    current.addEventListener('open', () => {
      attempts = 0
      ping = setInterval(() => current.send('ping'), every)
    })
    current.addEventListener('message', event => {
      clearTimeout(deadline)
      deadline = setTimeout(lost, within)
      if (typeof event.data === 'string') onText(event.data)
      if (event.data instanceof ArrayBuffer) onBinary(new Uint8Array(event.data))
    })
    current.addEventListener('close', lost)
  }

  open()
  return {
    close: () => {
      stopped = true
      clearTimeout(timer)
      lose()
    }
  }
}
