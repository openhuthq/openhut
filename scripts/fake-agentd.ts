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
const OFF_TAILNET = { state: 'NeedsLogin', tailnet: '', name: '', address: '' }
const ON_TAILNET = { state: 'Running', tailnet: 'example.ts.net', name: 'openhut.example.ts.net', address: '100.101.102.103' }
let tailnet = OFF_TAILNET
const SAMPLE_MEMORY = {
  notes: 'Orders DB: late means no shipment 5 days after the order date.\n§\nRefunds over €100 need David\'s okay first.\n§\nThe Berlin depot closes at 18:00.',
  people: 'David runs operations and approves refunds.\n§\nPablo prefers short answers with the order number first.',
}
const memories: Record<string, Record<'notes' | 'people', string | null>> = {}
const SLACK_CHANNELS = [
  ['C0SUPPORT1', 'support', 42, false, false], ['C0ENGINEER', 'engineering', 31, false, false], ['C0SALES001', 'sales', 17, false, false],
  ['C0DESIGN01', 'design', 8, false, false], ['C0GENERAL1', 'general', 128, false, false], ['C0RANDOM01', 'random', 120, false, false],
  ['C0GROWTH01', 'growth', 14, false, true], ['G0LEADERS1', 'leadership', 6, true, true], ['C0PARTNER1', 'acme-partners', 23, false, true, true],
  ['G0MPIM0001', 'mpdm-mo--sara--gus-1', 3, true, true, false, true],
].map(([id, name, num_members, is_private, is_member, is_ext_shared, is_mpim]) => ({ id, name, num_members, is_private, is_member, is_ext_shared, is_mpim }))
const skills: Record<string, string> = {
  'late-invoices': '---\nname: late-invoices\ndescription: Chase invoices more than 30 days late.\n---\n\n# Late invoices\n\n1. Query invoices past due.\n2. Draft a reminder per customer.\n',
  'research/arxiv': '---\nname: arxiv\ndescription: "Search and summarise arXiv papers."\n---\n\n# arXiv\n',
  'productivity/pdf': '---\nname: pdf\ndescription: Read and fill PDF files.\n---\n\n# PDF\n',
  ...Object.fromEntries([
    ['apple/apple-notes', 'Manage Apple Notes via memo CLI: create, search, edit.'],
    ['autonomous-ai-agents/claude-code', 'Delegate coding to Claude Code CLI (features, PRs).'],
    ['autonomous-ai-agents/codex', 'Delegate coding to OpenAI Codex CLI (features, PRs).'],
    ['creative/manim-video', 'Manim CE animations: 3Blue1Brown math/algo videos.'],
    ['creative/p5js', 'p5.js sketches: gen art, shaders, interactive, 3D.'],
    ['devops/sdlc-review', 'Review Kanban handoffs and route verified outcomes.'],
    ['email/himalaya', 'Himalaya CLI: IMAP/SMTP email from terminal.'],
    ['media/youtube-content', 'YouTube transcripts to summaries, threads, blogs.'],
    ['note-taking/obsidian', 'Read, search, create, and edit notes in the Obsidian vault.'],
    ['productivity/google-workspace', 'Gmail, Calendar, Drive, Docs, Sheets via gws CLI or Python.'],
    ['social-media/xurl', 'X/Twitter via xurl CLI: raw post search, posting, DM, media.'],
    ['software-development/github', 'GitHub via gh CLI: PRs, issues, reviews, repos, auth.'],
    ['software-development/systematic-debugging', '4-phase root cause debugging: understand bugs before fixing.'],
    ['web/blocked-page-recovery', 'Use when a fetch fails: 403/429, paywall, WAF, bot wall.'],
  ].map(([path, description]) => [path, `---\nname: ${path.split('/')[1]}\ndescription: ${description}\n---\n\n# ${path.split('/')[1]}\n`])),
}

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
    if (req.url?.startsWith('/slack/')) return res.writeHead(200, { 'content-type': 'application/json', 'x-oauth-scopes': 'channels:read,channels:join,chat:write' }).end(JSON.stringify(fakeSlack(req.url.slice(7), new URLSearchParams(raw))))
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

function fakeSlack(method: string, params: URLSearchParams) {
  if (method === 'auth.test') return { ok: true, team: 'Acme', user: 'gus', bot_id: 'B0FAKEGUS' }
  if (method === 'bots.info') return { ok: true, bot: { app_id: 'A0FAKEGUS' } }
  if (method === 'conversations.list') return { ok: true, channels: SLACK_CHANNELS.filter((each) => !!each.is_mpim === (params.get('types') === 'mpim')), response_metadata: { next_cursor: '' } }
  if (method === 'conversations.join') Object.assign(SLACK_CHANNELS.find((each) => each.id === params.get('channel')) ?? {}, { is_member: true })
  return { ok: true }
}

function handle(req: AgentdRequest): AgentdReplies[AgentdRequest['cmd']] {
  switch (req.cmd) {
    case 'health':
      return { firewall: true, image: IMAGE, updating: false }
    case 'ps':
      return { states }
    case 'containers':
      return { containers: Object.entries(states).map(([id, state]) => ({ name: `ag-${id}`, agentId: id, state, status: state === 'running' ? 'Up 2 minutes' : 'Exited (0) 1 minute ago', image: IMAGE, createdAt: new Date().toISOString(), networks: `ag-${id}` })) }
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
    case 'skills':
      return { skills: Object.entries(skills).map(([path, body]) => ({ path, head: body })), bundled: Object.keys(skills).filter((path) => path.includes('/')).map((path) => `${path.split('/')[1]}:abc\n`).join('') }
    case 'skill-read':
      if (!skills[req.path]) throw new Error('that skill is gone')
      return { body: skills[req.path] }
    case 'skill-write':
      if (!skills[req.path]) throw new Error('that skill is gone')
      skills[req.path] = req.body
      return { written: req.path }
    case 'skill-rm':
      delete skills[req.path]
      return { removed: req.path }
    case 'memory':
      return memories[req.id] ??= { ...SAMPLE_MEMORY }
    case 'memory-write':
      if ((memories[req.id] ??= { ...SAMPLE_MEMORY })[req.target] === null) throw new Error('the agent has not saved that memory yet')
      memories[req.id][req.target] = req.body
      return { written: req.target }
    case 'send':
      console.log(`fake agentd: ${req.id} posts to ${req.to}: ${req.text.slice(0, 200)}`)
      return { sent: req.to }
    case 'send-targets':
      return { targets: [{ id: 'slack:C0FAKEGTM', platform: 'slack', name: '#gtm', type: 'channel' }, { id: 'telegram:-100123456', platform: 'telegram', name: 'Sales group', type: 'group' }, { id: 'whatsapp:120363000000@g.us', platform: 'whatsapp', name: 'Sales', type: 'group' }] }
    case 'messages':
      return { messages: Object.keys(states).slice(0, 1).map((agentId) => ({ agentId, source: 'slack', at: Date.now() / 1000 })) }
    case 'usage':
      return { usage: Object.fromEntries(Object.keys(states).map((id, index) => [id, 0.4 / (index + 1)])) }
    case 'ts-up':
      if (req.authKey.includes('bad')) throw new Error('backend error: invalid key: unable to validate API key')
      tailnet = ON_TAILNET
      return { ...tailnet, joined: true }
    case 'ts-status':
      return tailnet
    case 'ts-down':
      tailnet = OFF_TAILNET
      return tailnet
    case 'browser-still':
      return { open: false, url: '', title: '', data: '' }
    case 'browser-hold':
      return { held: req.held }
    case 'browser-live':
      return undefined
    default:
      throw new Error('unknown command')
  }
}
