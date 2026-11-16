import { createInterface } from 'node:readline'

const STILL_MS = 5000
const TRIES = 3
const RETRY_MS = 300
const PING_LIMIT_MS = 30_000
const BEAT_MS = 5000
const page = { url: '', title: '' }
const say = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

process.stdout.on('error', () => process.exit(0))

if (process.argv[2] === 'still') still(1)
else live()

function still(attempt) {
  const ws = new WebSocket('ws://127.0.0.1:9223')
  ws.addEventListener('error', () => {
    if (attempt < TRIES) return void setTimeout(() => still(attempt + 1), RETRY_MS)
    say({ type: 'closed' })
    process.exit(0)
  })
  ws.addEventListener('open', () => setTimeout(() => {
    say({ type: 'still', ...page, data: '' })
    process.exit(0)
  }, STILL_MS))
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.type === 'tabs') Object.assign(page, activeTab(message.tabs))
    if (message.type !== 'frame') return
    say({ type: 'still', ...page, data: message.data })
    process.exit(0)
  })
}

function live() {
  let pinged = Date.now()
  const ws = new WebSocket('ws://127.0.0.1:9223')
  ws.addEventListener('error', () => {
    say({ type: 'closed' })
    process.exit(0)
  })
  ws.addEventListener('close', () => process.exit(0))
  ws.addEventListener('message', ({ data }) => process.stdout.write(`${data}\n`))
  ws.addEventListener('open', () => createInterface({ input: process.stdin })
    .on('line', (line) => {
      pinged = Date.now()
      if (!line.includes('"type":"ping"')) ws.send(line)
    })
    .on('close', () => process.exit(0)))
  setInterval(() => {
    if (Date.now() - pinged > PING_LIMIT_MS) process.exit(0)
    process.stdout.write('\n')
  }, BEAT_MS)
}

function activeTab(tabs) {
  const tab = Array.isArray(tabs) ? tabs.find((each) => each.active) ?? tabs[0] : undefined
  return { url: String(tab?.url ?? ''), title: String(tab?.title ?? '') }
}
