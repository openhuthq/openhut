import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { memory } from '../packages/runtime/src/agentd/sandbox/memory.ts'
import type { Exec } from '../packages/runtime/src/agentd/sandbox/sandbox.ts'

const DATA = process.env.OPENHUT_DATA ?? '.data'
const AGENTD_DATA = `${DATA}/agentd`
const BIN = resolve(AGENTD_DATA, 'bin')
const SOCK = `${DATA}/agentd.sock`
const FAKES_PORT = 18642
const PAIR_MS = 6000
const PHONE = '15550001111'
const MEMORIES = {
  'MEMORY.md': 'Orders DB: late means no shipment 5 days after the order date.\n§\nRefunds over €100 need David\'s okay first.\n§\nThe Berlin depot closes at 18:00.',
  'USER.md': 'David runs operations and approves refunds.\n§\nPablo prefers short answers with the order number first.',
}
const BUNDLED = [
  ['research/arxiv', 'Search and summarise arXiv papers.'],
  ['productivity/pdf', 'Read and fill PDF files.'],
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
]
const SKILLS: Record<string, string> = {
  'late-invoices': '---\nname: late-invoices\ndescription: Chase invoices more than 30 days late.\n---\n\n# Late invoices\n\n1. Query invoices past due.\n2. Draft a reminder per customer.\n',
  ...Object.fromEntries(BUNDLED.map(([path, description]) => [path, `---\nname: ${path.split('/')[1]}\ndescription: ${description}\n---\n\n# ${path.split('/')[1]}\n`])),
}
const env = { ...process.env, AGENTD_SOCK: SOCK, OPENHUT_DATA: DATA, OPENHUT_CLIENT_KEY_SHA256: createHash('sha256').update('dev').digest('hex'), OPENHUT_MODEL: 'test', OPENHUT_AGENT_API: `http://127.0.0.1:${FAKES_PORT}`, OPENHUT_SLACK_API: `http://127.0.0.1:${FAKES_PORT}/slack` }
const TAILSCALE = `#!/bin/sh
up="$AGENTD_DATA/tailscale-up"
case "$1" in
  up) if grep -q bad "$(echo "$2" | sed 's/^--auth-key=file://')"; then echo 'backend error: invalid key: unable to validate API key' >&2; exit 1; fi; touch "$up" ;;
  logout) rm -f "$up" ;;
  status) if [ -f "$up" ]; then echo '{"BackendState":"Running","CurrentTailnet":{"Name":"example.ts.net"},"Self":{"DNSName":"openhut.example.ts.net.","TailscaleIPs":["100.101.102.103"]}}'; else echo '{"BackendState":"NeedsLogin"}'; fi ;;
esac
`
const SLACK_CHANNELS = [
  ['C0SUPPORT1', 'support', 42, false, false], ['C0ENGINEER', 'engineering', 31, false, false], ['C0SALES001', 'sales', 17, false, false],
  ['C0DESIGN01', 'design', 8, false, false], ['C0GENERAL1', 'general', 128, false, false], ['C0RANDOM01', 'random', 120, false, false],
  ['C0GROWTH01', 'growth', 14, false, true], ['G0LEADERS1', 'leadership', 6, true, true], ['C0PARTNER1', 'acme-partners', 23, false, true, true],
  ['G0MPIM0001', 'mpdm-mo--sara--gus-1', 3, true, true, false, true],
].map(([id, name, num_members, is_private, is_member, is_ext_shared, is_mpim]) => ({ id, name, num_members, is_private, is_member, is_ext_shared, is_mpim }))

mkdirSync(`${AGENTD_DATA}/whatsapp-bridge/node_modules`, { recursive: true })
mkdirSync(BIN, { recursive: true })
writeFileSync(`${BIN}/tailscale`, TAILSCALE, { mode: 0o755 })
rmSync(SOCK, { force: true })

createServer((req, res) => {
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
}).listen(FAKES_PORT, '127.0.0.1', () => console.log(`fake Hermes and Slack APIs on :${FAKES_PORT}`))

const plain = { ...memory }
Object.assign(memory, {
  async start(id: string) {
    await plain.start(id)
    seed(`${AGENTD_DATA}/agents/${id}`)
  },
  async run({ spec, command }: Parameters<typeof memory.run>[0]) {
    if (spec.entrypoint === 'rm') for (const path of command.filter((arg) => arg.startsWith('/opt/data/'))) rmSync(`${AGENTD_DATA}/agents/${spec.id}${path.slice('/opt/data'.length)}`, { recursive: true, force: true })
    return plain.run({ spec, command })
  },
  async exec(req: Parameters<typeof memory.exec>[0]) {
    const { id, command } = req
    if (command[1]?.endsWith('/bridge.js')) return fake({ lines: [{ event: 'qr', qr: `2@memory-pairing-${id},ref,key,adv` }], last: { event: 'connected', user: { id: `${PHONE}:1@s.whatsapp.net` } } })
    if (command.at(-1) === 'live') return fake({ lines: [{ type: 'closed' }] })
    return plain.exec(req)
  },
})
Object.assign(process.env, { OPENHUT_SANDBOX: 'memory', AGENTD_DATA, AGENTD_SOCK: SOCK, AGENTD_WHATSAPP_BRIDGE: `${AGENTD_DATA}/whatsapp-bridge`, PATH: `${BIN}:${process.env.PATH}` })
const { server } = await import('../packages/runtime/src/agentd/agentd.ts')
if (!server.listening) await once(server, 'listening')
const app = spawn(process.execPath, ['--env-file-if-exists=.env', 'packages/runtime/src/server/app.ts'], { env, stdio: 'inherit' })
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'packages/desktop/src/renderer'], { stdio: 'inherit' })
console.log('Open http://localhost:5173 (Vite sends the dev key, `Authorization: Bearer dev`). `node scripts/seed-ui.ts` adds sample agents and connections.')
for (const child of [app, vite]) {
  child.on('exit', (code) => {
    process.exitCode ??= code ?? 0
    app.kill()
    vite.kill()
    process.exit()
  })
}

function fakeSlack(method: string, params: URLSearchParams) {
  if (method === 'auth.test') return { ok: true, team: 'Acme', user: 'gus', bot_id: 'B0FAKEGUS' }
  if (method === 'bots.info') return { ok: true, bot: { app_id: 'A0FAKEGUS' } }
  if (method === 'conversations.list') return { ok: true, channels: SLACK_CHANNELS.filter((each) => !!each.is_mpim === (params.get('types') === 'mpim')), response_metadata: { next_cursor: '' } }
  if (method === 'conversations.join') Object.assign(SLACK_CHANNELS.find((each) => each.id === params.get('channel')) ?? {}, { is_member: true })
  return { ok: true }
}

function seed(home: string) {
  if (!existsSync(home) || existsSync(`${home}/skills/.bundled_manifest`)) return
  for (const [path, body] of Object.entries(SKILLS)) {
    mkdirSync(`${home}/skills/${path}`, { recursive: true })
    writeFileSync(`${home}/skills/${path}/SKILL.md`, body)
  }
  writeFileSync(`${home}/skills/.bundled_manifest`, BUNDLED.map(([path]) => `${path.split('/')[1]}:memory\n`).join(''))
  mkdirSync(`${home}/memories`, { recursive: true })
  for (const [file, body] of Object.entries(MEMORIES)) writeFileSync(`${home}/memories/${file}`, body)
}

function fake({ lines, last }: { lines: unknown[]; last?: unknown }): Exec {
  const stdout = new PassThrough()
  let code = 0
  const exit = new Promise<number>((resolve) => stdout.on('finish', () => resolve(code)))
  for (const each of lines) stdout.write(`${JSON.stringify(each)}\n`)
  const timer = setTimeout(() => end(last === undefined ? undefined : `${JSON.stringify(last)}\n`), last === undefined ? 0 : PAIR_MS)
  const end = (tail?: string) => {
    clearTimeout(timer)
    if (!stdout.writableEnded) stdout.end(tail)
  }
  return {
    stdin: null, stdout, exit, kill: () => {
      code = 137
      end()
    },
  }
}
