import { FrameType, REQUEST_HEADERS, chunks, decodeFrame, decodeJson, encodeFrame, encodeJson, stringRecord, type Frame } from './frames.ts'
import { fromHex, initiator, pairingProof, sixDigits, type DeviceKey, type Transport } from './noise.ts'

export type Invitation = { secret: string; name: string; kind: 'client' | 'computer'; computer?: { id: string; name: string } }
export type Tunnel = {
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  digits: string
  control: AsyncIterable<Record<string, unknown>>
  close: () => void
}
type Pending = { resolve: (response: Response) => void; reject: (error: Error) => void; body?: ReadableStreamDefaultController<Uint8Array> }

export class TunnelError extends Error {
  type: string
  constructor({ type, message }: { type: string; message: string }) {
    super(message)
    this.type = type
  }
}

const nullBody = new Set([204, 205, 304])
const empty = new Uint8Array(0)

function queue<T>() {
  const items: T[] = []
  let wake = () => {}
  let done = false
  return {
    push: (item: T) => {
      items.push(item)
      wake()
    },
    end: () => {
      done = true
      wake()
    },
    async *[Symbol.asyncIterator]() {
      while (items.length || !done) {
        const item = items.shift()
        if (item) yield item
        else await new Promise<void>(resolve => { wake = resolve })
      }
    }
  }
}

export async function connect(input: { relayUrl: string; computer: { id: string; key: string }; key: DeviceKey; invitation?: Invitation }): Promise<Tunnel> {
  const handshake = initiator({ key: input.key, remote: fromHex(input.computer.key) })
  const first = await handshake.write()
  const socket = new WebSocket(`${input.relayUrl}/v1/relay/${input.computer.id}?role=device`)
  socket.binaryType = 'arraybuffer'
  const streams = new Map<number, Pending>()
  const control = queue<Record<string, unknown>>()
  let session: Transport | undefined
  let failure: TunnelError | undefined
  let next = 1
  let inbox = Promise.resolve()

  const fail = (error: TunnelError) => {
    failure ??= error
    for (const pending of streams.values()) {
      if (pending.body) pending.body.error(error)
      else pending.reject(error)
    }
    streams.clear()
    control.end()
  }

  const send = (frame: Frame) => {
    if (failure) throw failure
    if (!session) throw new Error('The handshake has not finished.')
    socket.send(session.encrypt(encodeFrame(frame)))
  }

  const dispatch = ({ type, stream, payload }: Frame) => {
    if (type === FrameType.control) return control.push(decodeJson(payload))
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
    socket.addEventListener('open', () => socket.send(first))
    socket.addEventListener('message', event => {
      if (!(event.data instanceof ArrayBuffer)) return
      const data = event.data
      inbox = inbox.then(() => receive(data)).catch(() => socket.close())
    })
    socket.addEventListener('close', event => {
      const offline = event.code === 4004
      const error = new TunnelError({ type: offline ? 'offline' : 'closed', message: offline ? 'The computer is offline.' : 'The tunnel to the computer closed.' })
      fail(error)
      reject(error)
    })
  })

  const transport = await ready
  const digits = await sixDigits(transport.handshakeHash)
  if (input.invitation) {
    const { secret, ...hello } = input.invitation
    const proof = await pairingProof({ secret, handshakeHash: transport.handshakeHash })
    send({ type: FrameType.control, stream: 0, payload: encodeJson({ type: 'hello', proof, ...hello }) })
  }

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

  return { fetch, digits, control, close: () => socket.close() }
}
