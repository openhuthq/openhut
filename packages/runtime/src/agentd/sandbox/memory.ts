import { PassThrough } from 'node:stream'
import type { Exec, Sandboxes, SandboxSpec } from './sandbox.ts'

export const boxes = new Map<string, { spec: SandboxSpec; running: boolean; startedAt?: string }>()

export const memory: Sandboxes = {
  name: 'memory',

  async ready() {
    return { ok: true }
  },

  async create(spec) {
    boxes.set(spec.id, { spec, running: false })
  },

  async start(id) {
    const box = found(id)
    if (!box.running) Object.assign(box, { running: true, startedAt: new Date().toISOString() })
  },

  async stop({ id }) {
    found(id).running = false
  },

  async remove(id) {
    boxes.delete(id)
  },

  async exec({ id, stdin = false }): Promise<Exec> {
    if (!found(id).running) throw new Error(`ag-${id} is not running`)
    const stdout = new PassThrough()
    const input = stdin ? new PassThrough() : null
    let code = 0
    const exit = new Promise<number>((resolve) => stdout.on('finish', () => resolve(code)))
    const end = () => {
      if (!stdout.writableEnded) stdout.end()
    }
    if (input) input.on('end', end).resume()
    else end()
    return {
      stdin: input, stdout, exit, kill: () => {
        code = 137
        end()
      },
    }
  },

  async run() {
    return { code: 0, stdout: '' }
  },

  async list() {
    return [...boxes.values()].map(({ spec, running, startedAt }) => ({ id: spec.id, running, startedAt, labels: spec.labels }))
  },

  async progress() {
    return null
  },
}

function found(id: string) {
  const box = boxes.get(id)
  if (!box) throw new Error(`No such container: ag-${id}`)
  return box
}
