import { connect } from 'node:net'
import { join } from 'node:path'
import { mux } from '@openhut/common/tunnel/mux.ts'
import { forward, type Link } from '../../../src/server/relay/forward.ts'
import { fakeAgentd } from '../agents/signed-in.ts'

let made = 0

export function fakeComputer({ id }: { id: string }) {
  const path = join(process.env.OPENHUT_DATA ?? '', `computer-${made++}.sock`)
  const agentd = fakeAgentd({ path })
  const opened: Record<string, unknown>[] = []
  const homes = new Map<string, string>()
  const broken = { pack: false, unpack: false }
  const sides: { main?: ReturnType<typeof mux>; runtime?: ReturnType<typeof mux> } = {}
  sides.main = mux({ odd: false, send: (bytes, done) => { queueMicrotask(() => sides.runtime?.receive(bytes)); done() }, accept: (_open, stream) => stream.destroy(), heard: () => undefined })
  sides.runtime = mux({
    odd: true,
    send: (bytes, done) => { queueMicrotask(() => sides.main?.receive(bytes)); done() },
    heard: () => undefined,
    accept: (open, stream) => {
      opened.push(open)
      const agent = String(open.id)
      if (open.to === 'agentd') {
        const socket = connect(path)
        stream.pipe(socket).pipe(stream)
        return
      }
      if (open.to === 'pack') return broken.pack || !homes.has(agent) ? stream.destroy() : stream.end(homes.get(agent))
      if (open.to === 'unpack') {
        let got = ''
        stream.on('data', (chunk: Buffer) => { got += chunk })
        stream.on('end', () => {
          if (broken.unpack) return stream.end('disk full')
          homes.set(agent, got)
          stream.end('ok')
        })
        return
      }
      stream.destroy()
    },
  })
  const ended = { count: 0 }
  const link: Link = { mux: sides.main, features: { whatsapp: false, browser: false }, gvisor: true, end: () => { ended.count++ } }
  forward.link({ computer: id, link })
  return { agentd, opened, homes, broken, link, ended }
}
