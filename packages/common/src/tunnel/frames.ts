export const FrameType = {
  requestHead: 0x01,
  requestBody: 0x02,
  requestEnd: 0x03,
  responseHead: 0x11,
  responseBody: 0x12,
  responseEnd: 0x13,
  responseError: 0x14,
  control: 0x20,
  socketOpen: 0x30,
  socketMessage: 0x31,
  socketClose: 0x32
} as const

export type FrameType = (typeof FrameType)[keyof typeof FrameType]
export type Frame = { type: FrameType; stream: number; payload: Uint8Array }

export const MAX_PLAINTEXT = 65_000
export const MAX_PAYLOAD = MAX_PLAINTEXT - 5
export const MAX_REQUEST_BODY = 257 << 20
export const REQUEST_HEADERS = ['content-type', 'accept', 'last-event-id']
export const MAX_SOCKET_MESSAGE = 1024 * 1024

export type SocketMessage = string | ArrayBuffer | Uint8Array

const BINARY = 1
const MORE = 2

const types = new Set<number>(Object.values(FrameType))

export function encodeFrame({ type, stream, payload }: Frame): Uint8Array {
  if (payload.byteLength > MAX_PAYLOAD) throw new Error('This frame is over the size limit.')
  const plaintext = new Uint8Array(5 + payload.byteLength)
  const view = new DataView(plaintext.buffer)
  view.setUint8(0, type)
  view.setUint32(1, stream)
  plaintext.set(payload, 5)
  return plaintext
}

export function decodeFrame(plaintext: Uint8Array): Frame {
  if (plaintext.byteLength < 5 || plaintext.byteLength > MAX_PLAINTEXT) throw new Error('This frame has the wrong size.')
  const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
  const type = view.getUint8(0)
  if (!isFrameType(type)) throw new Error('This frame has an unknown type.')
  return { type, stream: view.getUint32(1), payload: plaintext.subarray(5) }
}

function isFrameType(type: number): type is FrameType {
  return types.has(type)
}

export function* chunks(bytes: Uint8Array): Generator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_PAYLOAD) yield bytes.subarray(offset, offset + MAX_PAYLOAD)
}

export function* messageChunks(message: SocketMessage): Generator<Uint8Array> {
  const binary = typeof message !== 'string'
  const bytes = binary ? new Uint8Array(message) : new TextEncoder().encode(message)
  const size = MAX_PAYLOAD - 1
  for (let offset = 0; offset === 0 || offset < bytes.byteLength; offset += size) {
    const part = bytes.subarray(offset, offset + size)
    const chunk = new Uint8Array(1 + part.byteLength)
    chunk[0] = (binary ? BINARY : 0) | (offset + size < bytes.byteLength ? MORE : 0)
    chunk.set(part, 1)
    yield chunk
  }
}

export function messageJoiner() {
  let parts: Uint8Array[] = []
  let size = 0
  return {
    size: () => size,
    add(chunk: Uint8Array): string | ArrayBuffer | undefined {
      if (!chunk.byteLength) throw new Error('This message frame is empty.')
      parts.push(Uint8Array.from(chunk.subarray(1)))
      size += chunk.byteLength - 1
      if (chunk[0] & MORE) return undefined
      const bytes = new Uint8Array(size)
      parts.reduce((offset, part) => {
        bytes.set(part, offset)
        return offset + part.byteLength
      }, 0)
      parts = []
      size = 0
      return chunk[0] & BINARY ? bytes.buffer : new TextDecoder().decode(bytes)
    }
  }
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

export function decodeJson(payload: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(payload))
  if (!isRecord(value)) throw new Error('This frame does not hold a JSON object.')
  return value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}
