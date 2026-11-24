import { FrameType, REQUEST_HEADERS, chunks, decodeFrame, decodeJson, encodeFrame, encodeJson, messageChunks, messageJoiner, stringRecord, type Frame, type SocketMessage } from './frames.ts'
import { fromHex, initiator, type DeviceKey, type Transport } from './noise.ts'

export type TunnelSocket = {
  binaryType: 'arraybuffer'
  readyState: number
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
  send: (data: SocketMessage) => void
  close: (code?: number, reason?: string) => void
}
export type Tunnel = {
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  socket: (path: string) => TunnelSocket
  close: () => void
  readonly failure: TunnelError | undefined
}
type Closing = { code: number; reason: string }
type OpenSocket = { receive: (chunk: Uint8Array) => void; ended: (closing: Closing) => void }
type Pending = { resolve: (response: Response) => void; reject: (error: Error) => void; body?: ReadableStreamDefaultController<Uint8Array> }

export class TunnelError extends Error {
  type: string
  code: number | undefined
  reason: string | undefined
  constructor({ type, message, code, reason }: { type: string; message: string; code?: number; reason?: string }) {
    super(message)
    this.type = type
    this.code = code
    this.reason = reason
  }
}

const nullBody = new Set([204, 205, 304])
const empty = new Uint8Array(0)

const PROTOCOL = 'openhut'

export async function connect(input: { relayUrl: string; computer: { id: string; key: string }; key: DeviceKey; token: string; url?: string; timeout?: number }): Promise<Tunnel> {
  const handshake = initiator({ key: input.key, remote: fromHex(input.computer.key) })
  const first = await handshake.write()
  const socket = new WebSocket(input.url ?? `${input.relayUrl}/v1/tunnels/${input.computer.id}?role=device`, [PROTOCOL, input.token])
  socket.binaryType = 'arraybuffer'
  const streams = new Map<number, Pending>()
  const sockets = new Map<number, OpenSocket>()
  let session: Transport | undefined
  let failure: TunnelError | undefined
  let next = 1
  let inbox = Promise.resolve()
  let late: ReturnType<typeof setTimeout> | undefined

  const fail = (error: TunnelError) => {
    failure ??= error
    for (const pending of streams.values()) {
      if (pending.body) pending.body.error(error)
      else pending.reject(error)
    }
    streams.clear()
    for (const open of sockets.values()) open.ended({ code: 1006, reason: error.message })
  }

  const send = (frame: Frame) => {
    if (failure) throw failure
    if (!session) throw new Error('The handshake has not finished.')
    socket.send(new Uint8Array(session.encrypt(encodeFrame(frame))))
  }

  const dispatch = ({ type, stream, payload }: Frame) => {
    if (type === FrameType.control) return
    if (type === FrameType.socketMessage) return sockets.get(stream)?.receive(payload)
    if (type === FrameType.socketClose) return sockets.get(stream)?.ended(closingOf(payload))
    const pending = streams.get(stream)
    if (!pending) return
    if (type === FrameType.responseHead && !pending.body) {
      const head = decodeJson(payload)
      const status = Number(head.status)
      const body = new ReadableStream<Uint8Array>({ start: controller => { pending.body = controller } })
      return pending.resolve(new Response(nullBody.has(status) ? null : body, { status, headers: stringRecord(head.headers) }))
    }
    if (type === FrameType.responseBody && pending.body) return pending.body.enqueue(Uint8Array.from(payload))
    if (type === FrameType.responseEnd && pending.body) {
      streams.delete(stream)
      return pending.body.close()
    }
    if (type === FrameType.responseError) {
      const error = decodeJson(payload)
      streams.delete(stream)
      const tunnelError = new TunnelError({ type: String(error.type), message: String(error.message) })
      if (pending.body) return pending.body.error(tunnelError)
      return pending.reject(tunnelError)
    }
    throw new Error('The computer sent a frame out of order.')
  }

  const ready = new Promise<Transport>((resolve, reject) => {
    const receive = async (data: ArrayBuffer) => {
      if (failure) return
      const bytes = new Uint8Array(data)
      if (!session) {
        session = (await handshake.read(bytes)).transport
        return resolve(session)
      }
      dispatch(decodeFrame(session.decrypt(bytes)))
    }
    let opened = false
    socket.addEventListener('open', () => {
      opened = true
      socket.send(new Uint8Array(first))
    })
    const closed = (code: number, reason?: string) => {
      const offline = code === 4004 || !opened
      const error = new TunnelError({ type: offline ? 'offline' : 'closed', message: offline ? 'The computer is offline.' : 'The tunnel to the computer closed.', code, reason })
      fail(error)
      reject(error)
    }
    socket.addEventListener('message', event => {
      if (typeof event.data === 'string') return closing(event.data, closed)
      if (!(event.data instanceof ArrayBuffer)) return
      const data = event.data
      inbox = inbox.then(() => receive(data)).catch(() => socket.close())
    })
    socket.addEventListener('close', event => closed(event.code, event.reason))
    socket.addEventListener('error', () => { if (!opened) closed(1006) })
    late = setTimeout(() => {
      const error = new TunnelError({ type: 'closed', message: 'The computer didn\'t answer in time.' })
      fail(error)
      reject(error)
      socket.close()
    }, input.timeout ?? 15_000)
  })

  await ready.finally(() => clearTimeout(late))

  const fetch = async (path: string, init?: RequestInit) => {
    if (failure) throw failure
    const request = new Request(new URL(path, 'http://tunnel'), init)
    const stream = next++
    const headers = Object.fromEntries(REQUEST_HEADERS.flatMap(name => {
      const value = request.headers.get(name)
      return value === null ? [] : [[name, value]]
    }))
    const response = new Promise<Response>((resolve, reject) => streams.set(stream, { resolve, reject }))
    response.catch(() => {})
    send({ type: FrameType.requestHead, stream, payload: encodeJson({ method: request.method, path, headers }) })
    const reader = request.body?.getReader()
    for (let part = await reader?.read(); part && !part.done; part = await reader?.read()) {
      for (const chunk of chunks(part.value)) send({ type: FrameType.requestBody, stream, payload: chunk })
    }
    send({ type: FrameType.requestEnd, stream, payload: empty })
    return response
  }

  const open = (path: string): TunnelSocket => {
    if (failure) throw failure
    const stream = next++
    const join = messageJoiner()
    const opened: TunnelSocket = {
      binaryType: 'arraybuffer',
      readyState: 1,
      onmessage: null,
      onclose: null,
      send: data => {
        if (opened.readyState !== 1) return
        for (const chunk of messageChunks(data)) send({ type: FrameType.socketMessage, stream, payload: chunk })
      },
      close: (code = 1000, reason = '') => {
        if (!sockets.has(stream)) return
        if (!failure) send({ type: FrameType.socketClose, stream, payload: encodeJson({ code, reason }) })
        ended({ code, reason })
      }
    }
    const ended = (closing: Closing) => {
      sockets.delete(stream)
      opened.readyState = 3
      opened.onclose?.(closing)
    }
    const receive = (chunk: Uint8Array) => {
      const data = join.add(chunk)
      if (data !== undefined) opened.onmessage?.({ data })
    }
    sockets.set(stream, { receive, ended })
    send({ type: FrameType.socketOpen, stream, payload: encodeJson({ path }) })
    return opened
  }

  return { fetch, socket: open, close: () => socket.close(), get failure() { return failure } }
}

function closingOf(payload: Uint8Array): Closing {
  const { code, reason } = decodeJson(payload)
  return { code: typeof code === 'number' ? code : 1005, reason: typeof reason === 'string' ? reason : '' }
}

function closing(text: string, closed: (code: number, reason?: string) => void): void {
  const notice = parsed(text)
  if (typeof notice === 'object' && notice !== null && 'type' in notice && notice.type === 'closing' && 'code' in notice && typeof notice.code === 'number') closed(notice.code, 'reason' in notice && typeof notice.reason === 'string' ? notice.reason : undefined)
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
