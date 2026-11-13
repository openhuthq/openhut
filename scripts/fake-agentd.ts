import { readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import type { AgentdReplies, AgentdRequest } from '../packages/agentd/src/agentd.ts'

const SOCK = process.env.AGENTD_SOCK ?? '/tmp/fm-agentd.sock'
const IMAGE = readFileSync(new URL('../install/agent-image', import.meta.url), 'utf8').trim()
const FAKE_PHONE = '15550001111'
const HERMES_PORT = 18642
const states: Record<string, string> = {}
const rendered: Record<string, string> = {}
const pairReads: Record<string, number> = {}

rmSync(SOCK, { force: true })
createServer({ allowHalfOpen: true }, (sock) => {
  let buf = ''
  const read = (chunk: string | Buffer) => {
    buf += chunk
    const end = buf.indexOf('\n')
    if (end < 0) return
    sock.off('data', read)
    try {
      sock.end(JSON.stringify({ ok: true, ...handle(JSON.parse(buf.slice(0, end))) }))
    } catch (e) {
      sock.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }
  sock.setEncoding('utf8')
  sock.on('data', read)
}).listen(SOCK, () => console.log(`fake agentd on ${SOCK}`))

createHttpServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', async () => {
    if (req.url?.endsWith('/models')) return res.writeHead(200, { 'content-type': 'application/json' }).end('{"object":"list","data":[{"id":"hermes-agent"}]}')
    const messages: { content: string }[] = JSON.parse(raw || '{}').messages ?? []
    const last = messages.at(-1)?.content ?? ''
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const say = async (text: string) => {
      for (const word of text.split(/(?<= )/)) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: word } }] })}\n\n`)
        await sleep(40)
      }
    }
    if (/^sql:/i.test(last)) {
      await say('Running that query. ')
      res.write('event: hermes.tool.progress\ndata: {"tool":"call_tool","label":"postgres_query"}\n\n')
      await sleep(600)
    }
    await say(`Fake Hermes heard: **${last}** (message ${messages.length} in this thread).`)
    res.end('data: [DONE]\n\n')
  })
}).listen(HERMES_PORT, '127.0.0.1', () => console.log(`fake Hermes API on :${HERMES_PORT}`))

function handle(req: AgentdRequest): AgentdReplies[AgentdRequest['cmd']] {
  switch (req.cmd) {
    case 'health':
      return { firewall: true, image: IMAGE }
    case 'ps':
      return { states }
    case 'create':
      states[req.id] = 'created'
      rendered[req.id] = JSON.stringify(req.files)
      return { container: `ag-${req.id}` }
    case 'apply': {
      const files = JSON.stringify(req.files)
      const restarted = req.restart && (req.force === true || files !== rendered[req.id])
      rendered[req.id] = files
      if (restarted) states[req.id] = 'running'
      return { applied: req.id, restarted }
    }
    case 'start':
      states[req.id] = 'running'
      return { started: req.id }
    case 'stop':
      delete pairReads[req.id]
      states[req.id] = 'exited'
      return { stopped: req.id }
    case 'rm':
      delete states[req.id]
      delete rendered[req.id]
      delete pairReads[req.id]
      return { removed: req.id }
    case 'wa-pair': {
      if (states[req.id] !== 'running') throw new Error("the agent isn't running")
      const reads = (pairReads[req.id] ?? 0) + 1
      pairReads[req.id] = reads
      if (reads > 2) return { status: 'linked', phone: FAKE_PHONE }
      return { status: 'qr', qr: `2@fake-pairing-${req.id}-${reads},ref,key,adv` }
    }
    case 'wa-unlink':
      delete pairReads[req.id]
      return { unlinked: req.id }
    case 'update':
      return { updating: true }
    default:
      throw new Error('unknown command')
  }
}
