export const FrameType = {
  requestHead: 0x01,
  requestBody: 0x02,
  requestEnd: 0x03,
  responseHead: 0x11,
  responseBody: 0x12,
  responseEnd: 0x13,
  responseError: 0x14,
  control: 0x20
} as const

export type FrameType = (typeof FrameType)[keyof typeof FrameType]
export type Frame = { type: FrameType; stream: number; payload: Uint8Array }

export const MAX_PLAINTEXT = 65_000
export const MAX_PAYLOAD = MAX_PLAINTEXT - 5
export const MAX_REQUEST_BODY = 1024 * 1024
export const REQUEST_HEADERS = ['content-type', 'accept', 'last-event-id']

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
