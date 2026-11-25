import { mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { APP_GID, own, SOCK } from './host.ts'
import { boot, serve } from './serve.ts'

await boot()
mkdirSync(dirname(SOCK), { recursive: true })
rmSync(SOCK, { force: true })
export const server = createServer({ allowHalfOpen: true }, serve).listen(SOCK, () => {
  own({ path: SOCK, uid: 0, gid: APP_GID, mode: 0o660 })
  console.log(`agentd on ${SOCK}`)
})

export type { AgentdReplies } from './commands.ts'
