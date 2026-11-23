import { mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { APP_GID, box, own, PIPE, SOCK } from './host.ts'
import { boot, serve } from './serve.ts'

await boot()
if (box.name === 'native') for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => process.exit(0))
if (!PIPE) mkdirSync(dirname(SOCK), { recursive: true })
if (!PIPE) rmSync(SOCK, { force: true })
export const server = createServer({ allowHalfOpen: true }, serve).listen(SOCK, () => {
  own({ path: SOCK, uid: 0, gid: APP_GID, mode: 0o660 })
  console.log(`agentd on ${SOCK}`)
})

export type { AgentdReplies } from './commands.ts'
