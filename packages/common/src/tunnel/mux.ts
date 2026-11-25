import { Duplex } from 'node:stream'
import { chunks, decodeFrame, decodeJson, encodeFrame, encodeJson, FrameType } from './frames.ts'

const END = 0
const ABORT = 1

export type Mux = ReturnType<typeof mux>

export function mux({ send, accept, heard, odd }: {
  send: (bytes: Uint8Array, done: (err?: Error) => void) => void
  accept: (open: Record<string, unknown>, stream: Duplex) => void
  heard: (message: Record<string, unknown>) => void
  odd: boolean
}) {
  const streams = new Map<number, Duplex>()
  let next = odd ? 1 : 2
  let closed = false
  const frame = (type: FrameType, stream: number, payload: Uint8Array, done: (err?: Error) => void = () => {}) => {
    if (closed) return done(new Error('The link closed.'))
    send(encodeFrame({ type, stream, payload }), done)
  }

  const duplexOf = (id: number): Duplex => {
    let ended = { here: false, there: false }
    const forget = () => { if (ended.here && ended.there) streams.delete(id) }
    const stream = new Duplex({
      allowHalfOpen: true,
      read() {},
      write(chunk: Buffer, _encoding, callback) {
        const parts = [...chunks(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))]
        if (!parts.length) return callback()
        parts.forEach((part, index) => frame(FrameType.socketMessage, id, part, index === parts.length - 1 ? callback : undefined))
      },
      final(callback) {
        ended.here = true
        frame(FrameType.socketClose, id, Uint8Array.of(END))
        forget()
        callback()
      },
      destroy(err, callback) {
        if (streams.get(id) === stream) frame(FrameType.socketClose, id, Uint8Array.of(ABORT))
        streams.delete(id)
        ended = { here: true, there: true }
        callback(err)
      },
    })
    stream.on('end', () => { ended.there = true; forget() })
    streams.set(id, stream)
    return stream
  }

  return {
    open(request: Record<string, unknown>): Duplex {
      const id = next
      next += 2
      const stream = duplexOf(id)
      frame(FrameType.socketOpen, id, encodeJson(request))
      return stream
    },

    say(message: Record<string, unknown>): void {
      frame(FrameType.control, 0, encodeJson(message))
    },

    receive(bytes: Uint8Array): void {
      const { type, stream: id, payload } = decodeFrame(bytes)
      if (type === FrameType.control) return heard(decodeJson(payload))
      if (type === FrameType.socketOpen) {
        if (id % 2 === (odd ? 1 : 0) || streams.has(id)) throw new Error('The other side opened a stream it doesn\'t own.')
        accept(decodeJson(payload), duplexOf(id))
        return
      }
      const stream = streams.get(id)
      if (!stream) return
      if (type === FrameType.socketMessage) stream.push(Buffer.from(payload))
      else if (type === FrameType.socketClose && payload[0] === END) stream.push(null)
      else if (type === FrameType.socketClose) {
        streams.delete(id)
        stream.destroy()
      }
    },

    close(): void {
      closed = true
      for (const stream of streams.values()) stream.destroy()
      streams.clear()
    },
  }
}
