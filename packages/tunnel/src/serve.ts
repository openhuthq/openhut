import { FrameType, MAX_REQUEST_BODY, MAX_SOCKET_MESSAGE, REQUEST_HEADERS, chunks, decodeFrame, decodeJson, encodeFrame, encodeJson, isRecord, messageChunks, messageJoiner, stringRecord, type Frame, type SocketMessage } from './frames.ts'
import { fromHex, responder, toHex, type ComputerKey, type Transport } from './noise.ts'

export type TunnelRequest = { device: string; method: string; path: string; headers: Record<string, string>; body: ReadableStream<Uint8Array> }
export type SocketPeer = { send: (data: SocketMessage) => void; close: () => void }
export type TunnelSocketRequest = { device: string; path: string; headers: Record<string, string> } & Pick<SocketPeer, 'send'> & { close: (input: { code: number; reason: string }) => void }
export type Handlers = {
  listed: (key: string) => boolean
  handle: (input: TunnelRequest) => Promise<Response>
  socket: (input: TunnelSocketRequest) => Promise<SocketPeer>
}
export type ServeInput = Handlers & {
  relayUrl: string
  computerId: string
  token: () => Promise<string>
  key: ComputerKey
  keepalive?: { every: number; within: number }
}
export type Pipe = { send: (bytes: Uint8Array) => void; close: () => void }
export type PipeSession = { receive: (bytes: Uint8Array) => void; end: () => void }
type Socket = { peer: Promise<SocketPeer>; join: ReturnType<typeof messageJoiner> }
type Incoming = { method: string; path: string; headers: Record<string, string>; parts: Uint8Array<ArrayBuffer>[]; size: number }
type Session = {
  pipe: Pipe
  key: string
  transport?: Transport
  ended: boolean
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

function allowedHeaders(headers: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(stringRecord(headers)).filter(([name]) => REQUEST_HEADERS.includes(name)))
}

export function sessions(input: Handlers & { key: ComputerKey }): (pipe: Pipe) => PipeSession {
  return (pipe) => {
    const session: Session = { pipe, key: '', ended: false, requests: new Map(), sockets: new Map(), readers: new Set() }
    return { receive: (bytes) => receive(session, bytes), end: () => drop(session) }
  }

  function drop(session: Session) {
    if (session.ended) return
    session.ended = true
    for (const reader of session.readers) reader.cancel().catch(() => {})
    for (const { peer } of session.sockets.values()) peer.then(open => open.close(), () => {})
    session.sockets.clear()
  }

  function kill(session: Session) {
    if (session.ended) return
    drop(session)
    session.pipe.close()
  }

  function send(session: Session, frame: Frame) {
    if (session.ended || !session.transport) return
    session.pipe.send(new Uint8Array(session.transport.encrypt(encodeFrame(frame))))
  }

  function reply({ session, stream, status }: { session: Session; stream: number; status: number }) {
    send(session, { type: FrameType.responseHead, stream, payload: encodeJson({ status, headers: {} }) })
    send(session, { type: FrameType.responseEnd, stream, payload: empty })
  }

  function fault({ session, stream, message }: { session: Session; stream: number; message: string }) {
    send(session, { type: FrameType.responseError, stream, payload: encodeJson({ type: 'internal', message }) })
  }

  async function respond({ session, stream, incoming }: { session: Session; stream: number; incoming: Incoming }) {
    const { method, path, parts, size } = incoming
    const headers = size ? { ...incoming.headers, 'content-length': String(size) } : incoming.headers
    let response: Response
    try {
      response = await input.handle({ device: session.key, method, path, headers, body: new Blob(parts).stream() })
    } catch {
      return fault({ session, stream, message: 'The computer could not answer this request.' })
    }
    if (session.ended) return response.body?.cancel()
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

  function admitted({ session, removed }: { session: Session; removed: Frame }) {
    if (input.listed(session.key)) return true
    send(session, removed)
    kill(session)
    return false
  }

  function removedSocket(stream: number): Frame {
    return { type: FrameType.socketClose, stream, payload: encodeJson({ code: 4403, reason: 'This device was removed.' }) }
  }

  function begin({ session, stream, payload }: { session: Session; stream: number; payload: Uint8Array }) {
    if (!admitted({ session, removed: { type: FrameType.responseError, stream, payload: encodeJson({ type: 'removed', message: 'This device was removed.' }) } })) return
    const head = decodeJson(payload)
    if (session.requests.has(stream) || typeof head.method !== 'string' || typeof head.path !== 'string' || !head.path.startsWith('/')) return kill(session)
    session.requests.set(stream, { method: head.method, path: head.path, headers: allowedHeaders(head.headers), parts: [], size: 0 })
  }

  function shut({ session, stream, code, reason }: { session: Session; stream: number; code: number; reason: string }) {
    const open = session.sockets.get(stream)
    if (!open) return
    session.sockets.delete(stream)
    send(session, { type: FrameType.socketClose, stream, payload: encodeJson({ code, reason }) })
    open.peer.then(peer => peer.close(), () => {})
  }

  function opening({ session, stream, payload }: { session: Session; stream: number; payload: Uint8Array }) {
    if (!admitted({ session, removed: removedSocket(stream) })) return
    const head = decodeJson(payload)
    if (session.sockets.has(stream) || typeof head.path !== 'string' || !head.path.startsWith('/')) return kill(session)
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

  function fromDevice({ session, stream, type, payload }: Frame & { session: Session }) {
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

  function frame(session: Session, { type, stream, payload }: Frame) {
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
    kill(session)
  }

  function receive(session: Session, payload: Uint8Array) {
    if (session.ended) return
    try {
      if (session.transport) return frame(session, decodeFrame(session.transport.decrypt(payload)))
      const handshake = responder({ key: input.key })
      handshake.read(payload)
      const { message, transport } = handshake.write()
      session.transport = transport
      session.key = toHex(transport.remoteKey)
      session.pipe.send(new Uint8Array(message))
    } catch {
      kill(session)
    }
  }
}

export function serve(input: ServeInput): { close: () => void } {
  const session = sessions(input)
  const live = new Map<string, PipeSession>()
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let stopped = false
  let lose = () => {}

  const pipeFor = (id: string): Pipe => ({
    send: (bytes) => socket?.send(new Uint8Array(envelope({ id, payload: bytes }))),
    close: () => {
      socket?.send(JSON.stringify({ type: 'close', session: id }))
      live.delete(id)
    },
  })

  const end = (id: string) => {
    live.get(id)?.end()
    live.delete(id)
  }

  const onBinary = (data: Uint8Array) => {
    if (data.byteLength < 16) return
    live.get(toHex(data.subarray(0, 16)))?.receive(data.subarray(16))
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
    if (message.type === 'open') {
      end(id)
      live.set(id, session(pipeFor(id)))
    }
    if (message.type === 'close') end(id)
  }

  const retry = () => {
    if (!stopped) timer = setTimeout(connect, Math.min(30_000, 250 * 2 ** attempts++))
  }

  const open = (token: string) => {
    if (stopped) return
    const { every, within } = input.keepalive ?? { every: 30_000, within: 75_000 }
    const current = new NodeSocket(`${input.relayUrl}/v1/relay/${input.computerId}?role=computer`, { headers: { 'x-openhut-token': token } })
    current.binaryType = 'arraybuffer'
    socket = current
    let ping: ReturnType<typeof setInterval> | undefined
    const lost = () => {
      if (socket !== current) return
      socket = undefined
      clearInterval(ping)
      clearTimeout(deadline)
      current.close()
      for (const id of [...live.keys()]) end(id)
      retry()
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
    current.addEventListener('error', lost)
  }

  const connect = () => void input.token().then(open, retry)

  connect()
  return {
    close: () => {
      stopped = true
      clearTimeout(timer)
      lose()
    }
  }
}
