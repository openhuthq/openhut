import { createInterface } from 'node:readline'

const STILL_MS = 5000
const page = { url: '', title: '' }
const ws = new WebSocket('ws://127.0.0.1:9223')
const say = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

ws.addEventListener('error', () => {
  say({ type: 'closed' })
  process.exit(0)
})
ws.addEventListener('close', () => process.exit(0))

if (process.argv[2] === 'still') {
  setTimeout(() => {
    say({ type: 'still', ...page, data: '' })
    process.exit(0)
  }, STILL_MS)
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.type === 'tabs') Object.assign(page, activeTab(message.tabs))
    if (message.type !== 'frame') return
    say({ type: 'still', ...page, data: message.data })
    process.exit(0)
  })
} else {
  ws.addEventListener('message', ({ data }) => process.stdout.write(`${data}\n`))
  ws.addEventListener('open', () => createInterface({ input: process.stdin }).on('line', (line) => ws.send(line)).on('close', () => process.exit(0)))
}

function activeTab(tabs) {
  const tab = Array.isArray(tabs) ? tabs.find((each) => each.active) ?? tabs[0] : undefined
  return { url: String(tab?.url ?? ''), title: String(tab?.title ?? '') }
}
