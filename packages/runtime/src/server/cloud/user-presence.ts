import { randomUUID } from 'node:crypto'

type Port = { postMessage: (message: unknown) => void; on: (event: 'message', listener: (event: { data: unknown }) => void) => void }
type Answer = { type: 'presence'; id: string; ok: boolean }

const parent: Port | undefined = Reflect.get(process, 'parentPort')
const waiting = new Map<string, (ok: boolean) => void>()
let listening = false

function answered(message: unknown): void {
  const answer = message as Partial<Answer> | null
  if (answer?.type !== 'presence' || typeof answer.id !== 'string') return
  waiting.get(answer.id)?.(answer.ok === true)
  waiting.delete(answer.id)
}

export const userPresence = {
  shell: (): boolean => Boolean(parent || process.send),

  async ask(reason: string): Promise<boolean> {
    if (!userPresence.shell()) return true
    if (!listening) {
      listening = true
      if (parent) parent.on('message', (event) => answered(event.data))
      else process.on('message', answered)
    }
    const id = randomUUID()
    const ok = new Promise<boolean>((resolve) => waiting.set(id, resolve))
    const message = { type: 'presence', id, reason }
    if (parent) parent.postMessage(message)
    else process.send?.(message)
    return ok
  },
}
