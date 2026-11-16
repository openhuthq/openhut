import { randomInt, webcrypto } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import * as z from 'zod/mini'
import { HttpError } from '../../platform/http-error.ts'
import { guardedFetch } from '../../platform/network.ts'
import { nativeConnector, nativeTool } from '../connector.ts'

const UPLOAD_URL = 'https://json.excalidraw.com/api/v2/post/'
const FONT_SIZE = 20
const LINE_HEIGHT = 1.25
const CHAR_WIDTH = 0.55
const PADDING = 10
const GAP = 6
const Id = z.string().check(z.regex(/^[A-Za-z0-9_-]{1,40}$/, 'Use letters, digits, - and _ in an id, 40 at most.'))
const Text = z.string().check(z.minLength(1), z.maxLength(400))
const Place = z.number().check(z.gte(-20_000), z.lte(20_000))
const Size = z.number().check(z.gte(20), z.lte(4000))
const Box = z.strictObject({
  id: Id, x: Place, y: Place, width: Size, height: Size, label: z.optional(Text),
  shape: z.optional(z.enum(['rectangle', 'ellipse', 'diamond'])),
  color: z.optional(z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/, 'Write a colour as #rrggbb.'))),
})
const Arrow = z.strictObject({ from: Id, to: Id, label: z.optional(Text) })
const Note = z.strictObject({ x: Place, y: Place, text: Text, size: z.optional(z.number().check(z.gte(10), z.lte(80))) })
const Drawing = z.strictObject({
  boxes: z.array(Box).check(z.minLength(1, 'Pass at least one box.'), z.maxLength(200)),
  arrows: z.optional(z.array(Arrow).check(z.maxLength(400))),
  notes: z.optional(z.array(Note).check(z.maxLength(100))),
})

export const excalidraw = {
  account: 'Public links on excalidraw.com',
  scene,
  pack,
  connector: nativeConnector({
    config: z.object({}),
    tools: {
      draw: nativeTool({
        description: 'Draw a diagram and get a link that opens it in Excalidraw, where people can edit it. Lay boxes out on a grid (x grows right, y grows down, about 200 by 80 each with 100 between them), join them with arrows by box id, and add notes for free text. Pastel colours like #a5d8ff, #b2f2bb, #fff3bf and #ffc9c9 read well. Anyone with the link can open the drawing, so leave secrets out. Send the link to the person.',
        input: Drawing,
        run: async ({ args }: { args: Drawing }) => ({ url: await upload(scene(args)) }),
      }),
    },
  }),
}

function scene(drawing: Drawing): Scene {
  const boxes = new Map(drawing.boxes.map((box) => [box.id, box]))
  if (boxes.size !== drawing.boxes.length) throw new HttpError(400, 'Give every box its own id.')
  const shapes = new Map(drawing.boxes.map((box) => [box.id, element({
    id: box.id, type: box.shape ?? 'rectangle', x: box.x, y: box.y, width: box.width, height: box.height,
    backgroundColor: box.color ?? 'transparent', roundness: box.shape === 'ellipse' ? null : { type: box.shape === 'diamond' ? 2 : 3 },
  })]))
  const labels = drawing.boxes.flatMap((box) => box.label ? [bound({ container: shapes.get(box.id), text: box.label, center: centerOf(box), width: box.width - PADDING * 2 })] : [])
  const arrows = (drawing.arrows ?? []).flatMap((arrow, index) => {
    const from = boxes.get(arrow.from)
    const to = boxes.get(arrow.to)
    if (!from || !to) throw new HttpError(400, `Arrow ${index + 1} joins ${arrow.from} to ${arrow.to}, and one of them is not a box id.`)
    const start = edge({ box: from, toward: centerOf(to) })
    const end = edge({ box: to, toward: centerOf(from) })
    if (!start || !end) throw new HttpError(400, `Arrow ${index + 1} joins two boxes that sit on the same spot. Move one of them.`)
    const line = element({
      id: `arrow:${index}`, type: 'arrow', x: start.x, y: start.y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
      points: [[0, 0], [end.x - start.x, end.y - start.y]], lastCommittedPoint: null, startArrowhead: null, endArrowhead: 'arrow', elbowed: false, roundness: { type: 2 },
      startBinding: { elementId: from.id, focus: 0, gap: GAP }, endBinding: { elementId: to.id, focus: 0, gap: GAP },
    })
    for (const id of [from.id, to.id]) shapes.get(id)?.boundElements.push({ type: 'arrow', id: line.id })
    return arrow.label ? [line, bound({ container: line, text: arrow.label, center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, width: 240 })] : [line]
  })
  const notes = (drawing.notes ?? []).map((note, index) => written({ id: `note:${index}`, text: note.text, size: note.size ?? FONT_SIZE, x: note.x, y: note.y, textAlign: 'left', verticalAlign: 'top', containerId: null }))
  return { type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: [...shapes.values(), ...labels, ...arrows, ...notes], appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} }
}

function bound({ container, text, center, width }: { container: Element | undefined; text: string; center: Point; width: number }): Element {
  if (!container) throw new HttpError(500, 'A label lost the shape it belongs to.')
  const wrapped = wrap({ text, width })
  const size = sizeOf({ text: wrapped, size: FONT_SIZE })
  const label = written({ id: `${container.id}:label`, text: wrapped, originalText: text, size: FONT_SIZE, x: center.x - size.width / 2, y: center.y - size.height / 2, textAlign: 'center', verticalAlign: 'middle', containerId: container.id })
  container.boundElements.push({ type: 'text', id: label.id })
  return label
}

function written({ id, text, originalText = text, size, x, y, textAlign, verticalAlign, containerId }: { id: string; text: string; originalText?: string; size: number; x: number; y: number; textAlign: string; verticalAlign: string; containerId: string | null }): Element {
  return element({ id, type: 'text', x, y, ...sizeOf({ text, size }), text, originalText, fontSize: size, fontFamily: 5, textAlign, verticalAlign, containerId, autoResize: true, lineHeight: LINE_HEIGHT })
}

function element({ id, type, x, y, width, height, ...rest }: { id: string; type: string; x: number; y: number; width: number; height: number } & Record<string, unknown>): Element {
  return {
    id, type, x, y, width, height, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: randomInt(2 ** 31), version: 1, versionNonce: randomInt(2 ** 31), isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false,
    ...rest,
  }
}

function wrap({ text, width }: { text: string; width: number }): string {
  const fits = Math.max(4, Math.floor(width / (FONT_SIZE * CHAR_WIDTH)))
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = []
    for (const word of paragraph.split(' ')) {
      const last = lines.at(-1)
      if (last !== undefined && `${last} ${word}`.length <= fits) lines[lines.length - 1] = `${last} ${word}`
      else lines.push(word)
    }
    return lines
  }).join('\n')
}

function sizeOf({ text, size }: { text: string; size: number }): { width: number; height: number } {
  const lines = text.split('\n')
  return { width: Math.max(...lines.map((line) => line.length)) * size * CHAR_WIDTH, height: lines.length * size * LINE_HEIGHT }
}

function centerOf(box: { x: number; y: number; width: number; height: number }): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function edge({ box, toward }: { box: { x: number; y: number; width: number; height: number }; toward: Point }): Point | undefined {
  const center = centerOf(box)
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  const length = Math.hypot(dx, dy)
  if (!length) return undefined
  const reach = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity)
  return { x: center.x + dx * reach + (dx / length) * GAP, y: center.y + dy * reach + (dy / length) * GAP }
}

async function pack(drawing: Scene): Promise<{ payload: Uint8Array; key: string }> {
  const encoder = new TextEncoder()
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt'])
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const inner = deflateSync(framed([encoder.encode('{}'), encoder.encode(JSON.stringify(drawing))]))
  const sealed = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, inner))
  const exported = await webcrypto.subtle.exportKey('jwk', key)
  if (!exported.k) throw new HttpError(500, 'The drawing could not be encrypted.')
  return { payload: framed([encoder.encode(JSON.stringify({ version: 2, compression: 'pako@1', encryption: 'AES-GCM' })), iv, sealed]), key: exported.k }
}

function framed(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(4 + parts.reduce((total, part) => total + 4 + part.length, 0))
  const view = new DataView(out.buffer)
  view.setUint32(0, 1)
  let offset = 4
  for (const part of parts) {
    view.setUint32(offset, part.length)
    out.set(part, offset + 4)
    offset += 4 + part.length
  }
  return out
}

async function upload(drawing: Scene): Promise<string> {
  const { payload, key } = await pack(drawing)
  const response = await guardedFetch(UPLOAD_URL, { method: 'POST', body: payload, signal: AbortSignal.timeout(20_000) })
  const stored = z.safeParse(z.object({ id: z.string().check(z.regex(/^[\w-]{1,80}$/)) }), await response.json().catch(() => undefined))
  if (!response.ok || !stored.success) throw new HttpError(502, `Excalidraw did not store the drawing (HTTP ${response.status}). Try again in a moment.`)
  return `https://excalidraw.com/#json=${stored.data.id},${key}`
}

type Drawing = z.infer<typeof Drawing>
type Point = { x: number; y: number }
type Element = { id: string; type: string; x: number; y: number; width: number; height: number; boundElements: { type: string; id: string }[] } & Record<string, unknown>
type Scene = { type: 'excalidraw'; version: 2; source: string; elements: Element[]; appState: Record<string, unknown>; files: Record<string, never> }
