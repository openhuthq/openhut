import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { excalidraw } from '../../../src/integrations/excalidraw/excalidraw.ts'

const BOXES = [
  { id: 'slack', x: 0, y: 0, width: 200, height: 80, label: 'Slack', color: '#a5d8ff' },
  { id: 'agent', x: 300, y: 0, width: 200, height: 80, label: 'An agent with a long name that has to wrap' },
]

test('a label is text bound to its box and wrapped to fit it', () => {
  const { elements } = excalidraw.scene({ boxes: BOXES })
  const box = elements.find((each) => each.id === 'agent')
  const label = elements.find((each) => each.id === 'agent:label')
  assert.deepEqual(box?.boundElements, [{ type: 'text', id: 'agent:label' }])
  assert.equal(label?.containerId, 'agent')
  assert.equal(label?.originalText, 'An agent with a long name that has to wrap')
  assert.match(String(label?.text), /\n/)
  assert.ok((label?.width ?? 999) <= 180)
})

test('an arrow runs between the facing edges of its two boxes and binds to both', () => {
  const { elements } = excalidraw.scene({ boxes: BOXES, arrows: [{ from: 'slack', to: 'agent', label: 'message' }] })
  const arrow = elements.find((each) => each.type === 'arrow')
  assert.equal(arrow?.x, 206)
  assert.equal(arrow?.y, 40)
  assert.deepEqual(arrow?.points, [[0, 0], [88, 0]])
  assert.deepEqual(elements.find((each) => each.id === 'slack')?.boundElements.map((each) => each.type), ['text', 'arrow'])
  assert.equal(elements.find((each) => each.id === 'arrow:0:label')?.containerId, 'arrow:0')
})

test('an arrow to a missing box, two boxes with one id and two boxes on one spot are refused', () => {
  assert.throws(() => excalidraw.scene({ boxes: BOXES, arrows: [{ from: 'slack', to: 'nowhere' }] }), /not a box id/)
  assert.throws(() => excalidraw.scene({ boxes: [BOXES[0], BOXES[0]] }), /its own id/)
  assert.throws(() => excalidraw.scene({ boxes: [BOXES[0], { ...BOXES[0], id: 'twin' }], arrows: [{ from: 'slack', to: 'twin' }] }), /same spot/)
})

test('the upload is the drawing, compressed and encrypted with the key that goes in the link', async () => {
  const drawing = excalidraw.scene({ boxes: BOXES })
  const { payload, key } = await excalidraw.pack(drawing)
  const [meta, iv, sealed] = unframed(payload)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(meta)), { version: 2, compression: 'pako@1', encryption: 'AES-GCM' })
  const imported = await webcrypto.subtle.importKey('jwk', { kty: 'oct', k: key, alg: 'A128GCM', ext: true, key_ops: ['decrypt'] }, { name: 'AES-GCM' }, false, ['decrypt'])
  const inner = inflateSync(new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, imported, new Uint8Array(sealed))))
  const [, data] = unframed(inner)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(data)), drawing)
})

function unframed(bytes: Uint8Array): Uint8Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(0), 1)
  const parts: Uint8Array[] = []
  for (let offset = 4; offset < bytes.length;) {
    const length = view.getUint32(offset)
    parts.push(bytes.subarray(offset + 4, offset + 4 + length))
    offset += 4 + length
  }
  return parts
}
