import { createInterface } from 'node:readline'

const PING_LIMIT_MS = 30_000
const BEAT_MS = 5000
const say = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

process.stdout.on('error', () => process.exit(0))

live()

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
