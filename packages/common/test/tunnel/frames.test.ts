import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FrameType, MAX_PAYLOAD, MAX_PLAINTEXT, chunks, decodeFrame, encodeFrame } from '../src/frames.ts'

test('a frame is one type byte, a big-endian stream id and the payload', () => {
  const plaintext = encodeFrame({ type: FrameType.responseBody, stream: 258, payload: new Uint8Array([9, 8]) })
  assert.deepEqual([...plaintext], [0x12, 0, 0, 1, 2, 9, 8])
  assert.deepEqual(decodeFrame(plaintext), { type: FrameType.responseBody, stream: 258, payload: new Uint8Array([9, 8]) })
})

test('frames over the cap, too short or of an unknown type are refused', () => {
  assert.throws(() => encodeFrame({ type: FrameType.requestBody, stream: 1, payload: new Uint8Array(MAX_PAYLOAD + 1) }))
  assert.throws(() => decodeFrame(new Uint8Array(MAX_PLAINTEXT + 1)))
  assert.throws(() => decodeFrame(new Uint8Array([1, 0, 0])))
  assert.throws(() => decodeFrame(new Uint8Array([0x7f, 0, 0, 0, 1])), /unknown type/)
})

test('bodies are cut into chunks that fit a frame', () => {
  const sizes = [...chunks(new Uint8Array(MAX_PAYLOAD * 2 + 10))].map(chunk => chunk.byteLength)
  assert.deepEqual(sizes, [MAX_PAYLOAD, MAX_PAYLOAD, 10])
  assert.equal(encodeFrame({ type: FrameType.requestBody, stream: 1, payload: new Uint8Array(MAX_PAYLOAD) }).byteLength, MAX_PLAINTEXT)
})
